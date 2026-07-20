/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LocalRouterServer - the app's own model router endpoint.
 *
 * A loopback-only (`127.0.0.1`, random port) OpenAI-compatible HTTP server:
 *
 *   GET  /v1/models            -> the four virtual tier models
 *   POST /v1/chat/completions  -> resolve the tier to a concrete connected
 *                                 model and forward the request, streaming
 *                                 the reply straight through (SSE-safe).
 *
 * Every request must carry `Authorization: Bearer <token>` with the token
 * minted for this app run - the same loopback+token pattern as
 * `HubToolsMcpServer`. Tier->target resolution is injected so this class
 * stays transport-only and unit-testable without the model registry.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  LOCAL_ROUTER_MODEL_IDS,
  LOCAL_ROUTER_PROVIDER_ID,
  isLocalRouterModelId,
  type LocalRouterModelId,
} from '@/common/config/localRouter';

/** A fully resolved forward destination for one request. */
export type ResolvedForward = {
  /** OpenAI-compatible base URL ending in `/v1` (no trailing slash). */
  baseUrl: string;
  /** Upstream bearer key; absent for keyless local servers. */
  apiKey?: string;
  /** Concrete model id to substitute for the tier id. */
  modelId: string;
};

/** Injected tier resolution. `null` = nothing routable connected. */
export type ResolveForwardFn = (tier: LocalRouterModelId) => Promise<ResolvedForward | null>;

type FetchLike = typeof fetch;

/** Upstream request timeout - generous because completions can be slow. */
const FORWARD_TIMEOUT_MS = 10 * 60 * 1000;
/** Request body cap; multimodal payloads can be large but not unbounded. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export class LocalRouterServer {
  private server: http.Server | null = null;
  private _port = 0;
  private readonly token = crypto.randomBytes(24).toString('hex');

  constructor(
    private readonly resolveForward: ResolveForwardFn,
    private readonly fetchFn: FetchLike = fetch
  ) {}

  get port(): number {
    return this._port;
  }

  get authToken(): string {
    return this.token;
  }

  /** `http://127.0.0.1:<port>/v1` - what provider rows / env injection use. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}/v1`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch((err) => {
        console.error('[LocalRouter] request handler crashed:', err);
        if (!res.headersSent) this.sendJson(res, 500, { error: { message: 'internal router error' } });
        else res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo | null;
        this._port = addr?.port ?? 0;
        resolve();
      });
      this.server!.once('error', reject);
    });
    console.log(`[LocalRouter] listening on ${this.baseUrl}`);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
    this._port = 0;
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (presented.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(this.token));
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(payload);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this._port}`);

    if (!this.authorized(req)) {
      this.sendJson(res, 401, { error: { message: 'invalid router token', type: 'invalid_request_error' } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      this.sendJson(res, 200, {
        object: 'list',
        data: LOCAL_ROUTER_MODEL_IDS.map((id) => ({
          id,
          object: 'model',
          created: 0,
          owned_by: LOCAL_ROUTER_PROVIDER_ID,
        })),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      await this.handleChatCompletions(req, res);
      return;
    }

    this.sendJson(res, 404, { error: { message: `no route for ${req.method} ${url.pathname}` } });
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      total += buf.length;
      if (total > MAX_BODY_BYTES) return null;
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  }

  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = await this.readBody(req);
    if (raw === null) {
      this.sendJson(res, 413, { error: { message: 'request body too large' } });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>;
    } catch {
      this.sendJson(res, 400, { error: { message: 'request body is not valid JSON' } });
      return;
    }

    const requestedModel = typeof body.model === 'string' ? body.model : '';
    if (!isLocalRouterModelId(requestedModel)) {
      this.sendJson(res, 404, {
        error: {
          message: `unknown model '${requestedModel}' - the Local Router serves: ${LOCAL_ROUTER_MODEL_IDS.join(', ')}`,
          type: 'invalid_request_error',
        },
      });
      return;
    }

    const target = await this.resolveForward(requestedModel);
    if (!target) {
      this.sendJson(res, 503, {
        error: {
          message:
            'the Local Router has nothing to route to - connect a provider or add a Model Hub server, ' + 'then retry',
          type: 'router_no_target',
        },
      });
      return;
    }

    body.model = target.modelId;

    let upstream: Response;
    try {
      upstream = await this.fetchFn(`${target.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      });
    } catch (err) {
      this.sendJson(res, 502, {
        error: {
          message: `upstream ${target.baseUrl} unreachable: ${err instanceof Error ? err.message : String(err)}`,
          type: 'router_upstream_error',
        },
      });
      return;
    }

    // Stream the upstream reply straight through - status, content type and
    // body bytes untouched, so SSE chunks reach the client as they arrive.
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    if (!upstream.body) {
      res.end();
      return;
    }
    try {
      for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        res.write(chunk);
      }
    } catch (err) {
      // Mid-stream upstream failure: the status line is already gone, so all
      // we can do is terminate the response and log.
      console.warn('[LocalRouter] upstream stream aborted:', err instanceof Error ? err.message : err);
    }
    res.end();
  }
}
