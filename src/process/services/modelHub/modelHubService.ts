/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model Hub - one dashboard over every model server the user runs.
 *
 * Aggregates models from registered servers into a single list:
 *  - Ollama servers (native API): full support - list (`/api/tags`), loaded
 *    state (`/api/ps`), and VRAM hot-swap (unload whatever is resident via
 *    `keep_alive: 0`, then warm the picked model so it owns the VRAM).
 *  - OpenAI-compatible servers (LM Studio, vLLM, llama.cpp server, ...):
 *    list via `/v1/models`; these runtimes have no standard unload API, so
 *    they are display-only (supportsSwap = false).
 *
 * All HTTP goes through an injectable fetch so the service is unit-testable
 * without sockets. Every per-server failure degrades to `online: false` -
 * one dead server never breaks the dashboard.
 */

import { ProcessConfig } from '../../utils/initStorage';

export type HubServerKind = 'ollama' | 'openai';

export type HubServer = {
  id: string;
  name: string;
  url: string;
  kind: HubServerKind;
};

export type HubServerStatus = HubServer & {
  online: boolean;
  error?: string;
};

export type HubModel = {
  serverId: string;
  serverName: string;
  kind: HubServerKind;
  name: string;
  sizeBytes?: number;
  family?: string;
  /** Currently resident in that server's VRAM (Ollama only). */
  loaded: boolean;
  /** Whether the one-click VRAM swap is available for this model. */
  supportsSwap: boolean;
};

export type HubSnapshot = {
  servers: HubServerStatus[];
  models: HubModel[];
};

export type LoadResult = { ok: true; loaded: string; unloaded: string[] } | { ok: false; error: string };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 7000;
/** How long a hub-loaded model stays resident before Ollama may evict it. */
const LOAD_KEEP_ALIVE = '30m';

const globalFetch: FetchLike = (url, init) => fetch(url, init);

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function fetchJson(fetchFn: FetchLike, url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** Probe a base URL: Ollama first (native API), then OpenAI-compatible. */
export async function detectServerKind(url: string, fetchFn: FetchLike = globalFetch): Promise<HubServerKind> {
  const base = normalizeUrl(url);
  try {
    await fetchJson(fetchFn, `${base}/api/tags`);
    return 'ollama';
  } catch {
    // fall through to OpenAI-compatible probe
  }
  await fetchJson(fetchFn, `${base}/v1/models`);
  return 'openai';
}

// ===== Server registry (persisted) =====

export async function listServers(): Promise<HubServer[]> {
  const stored = await ProcessConfig.get('modelHub.servers');
  return Array.isArray(stored) ? stored : [];
}

export async function addServer(
  input: { url: string; name?: string },
  fetchFn: FetchLike = globalFetch
): Promise<{ ok: true; server: HubServer } | { ok: false; error: string }> {
  const url = normalizeUrl(input.url);
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'invalid_url' };
  }
  const servers = await listServers();
  if (servers.some((s) => s.url === url)) {
    return { ok: false, error: 'duplicate' };
  }
  let kind: HubServerKind;
  try {
    kind = await detectServerKind(url, fetchFn);
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  const server: HubServer = {
    id: `hub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name?.trim() || new URL(url).host,
    url,
    kind,
  };
  await ProcessConfig.set('modelHub.servers', [...servers, server]);
  return { ok: true, server };
}

export async function removeServer(id: string): Promise<void> {
  const servers = await listServers();
  await ProcessConfig.set(
    'modelHub.servers',
    servers.filter((s) => s.id !== id)
  );
}

// ===== Aggregation =====

type OllamaTag = { name?: string; size?: number; details?: { family?: string } };

async function listOllamaModels(server: HubServer, fetchFn: FetchLike): Promise<HubModel[]> {
  const tags = (await fetchJson(fetchFn, `${server.url}/api/tags`)) as { models?: OllamaTag[] };
  let loadedNames = new Set<string>();
  try {
    const ps = (await fetchJson(fetchFn, `${server.url}/api/ps`)) as { models?: OllamaTag[] };
    loadedNames = new Set((ps.models ?? []).map((m) => m.name ?? '').filter(Boolean));
  } catch {
    // /api/ps unavailable (old Ollama) - loaded state simply unknown.
  }
  return (tags.models ?? [])
    .filter((m) => typeof m.name === 'string' && m.name)
    .map((m) => ({
      serverId: server.id,
      serverName: server.name,
      kind: 'ollama' as const,
      name: m.name as string,
      sizeBytes: typeof m.size === 'number' ? m.size : undefined,
      family: m.details?.family,
      loaded: loadedNames.has(m.name as string),
      supportsSwap: true,
    }));
}

async function listOpenAiModels(server: HubServer, fetchFn: FetchLike): Promise<HubModel[]> {
  const body = (await fetchJson(fetchFn, `${server.url}/v1/models`)) as { data?: Array<{ id?: string }> };
  return (body.data ?? [])
    .filter((m) => typeof m.id === 'string' && m.id)
    .map((m) => ({
      serverId: server.id,
      serverName: server.name,
      kind: 'openai' as const,
      name: m.id as string,
      loaded: false,
      supportsSwap: false,
    }));
}

/** One snapshot of every registered server and every model it advertises. */
export async function listAllModels(fetchFn: FetchLike = globalFetch): Promise<HubSnapshot> {
  const servers = await listServers();
  const statuses: HubServerStatus[] = [];
  const models: HubModel[] = [];

  await Promise.all(
    servers.map(async (server) => {
      try {
        const serverModels =
          server.kind === 'ollama' ? await listOllamaModels(server, fetchFn) : await listOpenAiModels(server, fetchFn);
        models.push(...serverModels);
        statuses.push({ ...server, online: true });
      } catch (err) {
        statuses.push({ ...server, online: false, error: err instanceof Error ? err.message : String(err) });
      }
    })
  );

  // Deterministic ordering: by server registration order, then model name.
  const order = new Map(servers.map((s, i) => [s.id, i]));
  models.sort((a, b) => {
    const so = (order.get(a.serverId) ?? 0) - (order.get(b.serverId) ?? 0);
    return so !== 0 ? so : a.name.localeCompare(b.name);
  });
  statuses.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { servers: statuses, models };
}

// ===== VRAM swap =====

/**
 * Make `model` the resident model on an Ollama server: every OTHER model
 * currently in VRAM is unloaded (`keep_alive: 0`), then the picked model is
 * warmed with an empty generate request so the weights load immediately
 * instead of on the first chat token.
 */
export async function loadModel(
  serverId: string,
  model: string,
  fetchFn: FetchLike = globalFetch
): Promise<LoadResult> {
  const server = (await listServers()).find((s) => s.id === serverId);
  if (!server) return { ok: false, error: 'server_not_found' };
  if (server.kind !== 'ollama') return { ok: false, error: 'swap_unsupported' };

  try {
    const unloaded: string[] = [];
    let resident: string[] = [];
    try {
      const ps = (await fetchJson(fetchFn, `${server.url}/api/ps`)) as { models?: OllamaTag[] };
      resident = (ps.models ?? []).map((m) => m.name ?? '').filter(Boolean);
    } catch {
      // Can't read resident set - proceed straight to loading; Ollama will
      // evict by its own policy if VRAM runs short.
    }

    for (const name of resident) {
      if (name === model) continue;
      await fetchJson(fetchFn, `${server.url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name, keep_alive: 0, stream: false }),
      });
      unloaded.push(name);
    }

    await fetchJson(fetchFn, `${server.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: LOAD_KEEP_ALIVE, stream: false }),
    });

    return { ok: true, loaded: model, unloaded };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
