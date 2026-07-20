/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';

import { LocalRouterServer, type ResolvedForward } from '@process/services/router/LocalRouterServer';

let server: LocalRouterServer | null = null;

afterEach(async () => {
  await server?.stop();
  server = null;
});

async function startServer(
  resolve: (tier: string) => Promise<ResolvedForward | null>,
  fetchFn?: typeof fetch
): Promise<LocalRouterServer> {
  server = new LocalRouterServer(resolve as never, fetchFn);
  await server.start();
  return server;
}

const authed = (s: LocalRouterServer): Record<string, string> => ({
  authorization: `Bearer ${s.authToken}`,
  'content-type': 'application/json',
});

describe('LocalRouterServer', () => {
  it('rejects requests without the minted bearer token', async () => {
    const s = await startServer(async () => null);
    const res = await fetch(`${s.baseUrl}/models`);
    expect(res.status).toBe(401);
    const wrong = await fetch(`${s.baseUrl}/models`, { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  it('lists the four tier models on /v1/models', async () => {
    const s = await startServer(async () => null);
    const res = await fetch(`${s.baseUrl}/models`, { headers: authed(s) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((m) => m.id).toSorted()).toEqual([
      'router-auto',
      'router-fast',
      'router-reasoning',
      'router-standard',
    ]);
  });

  it('rejects a non-tier model id with 404', async () => {
    const s = await startServer(async () => null);
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authed(s),
      body: JSON.stringify({ model: 'gpt-x', messages: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 503 when nothing is routable', async () => {
    const s = await startServer(async () => null);
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authed(s),
      body: JSON.stringify({ model: 'router-auto', messages: [] }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('router_no_target');
  });

  it('rewrites the model, forwards auth, and streams the upstream body through', async () => {
    const seen: { url?: string; auth?: string | null; model?: string } = {};
    const fetchStub: typeof fetch = async (url, init) => {
      seen.url = String(url);
      const headers = new Headers(init?.headers);
      seen.auth = headers.get('authorization');
      seen.model = (JSON.parse(String(init?.body)) as { model: string }).model;
      return new Response('data: {"ok":true}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const s = await startServer(
      async () => ({ baseUrl: 'http://upstream.test/v1', apiKey: 'sk-real', modelId: 'concrete-model' }),
      fetchStub
    );

    const res = await fetch(`${s.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authed(s),
      body: JSON.stringify({ model: 'router-fast', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toContain('data: [DONE]');
    expect(seen.url).toBe('http://upstream.test/v1/chat/completions');
    expect(seen.auth).toBe('Bearer sk-real');
    expect(seen.model).toBe('concrete-model');
  });

  it('maps an unreachable upstream to a 502 router error', async () => {
    const fetchStub: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const s = await startServer(
      async () => ({ baseUrl: 'http://upstream.test/v1', modelId: 'concrete-model' }),
      fetchStub
    );
    const res = await fetch(`${s.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authed(s),
      body: JSON.stringify({ model: 'router-auto', messages: [] }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('router_upstream_error');
  });
});
