/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model Hub service - aggregation across servers and the VRAM swap sequence
 * (unload residents first, then warm the picked model).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@/process/utils/initStorage', () => ({
  ProcessConfig: {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
  },
}));

import {
  addServer,
  detectServerKind,
  listAllModels,
  loadModel,
  listServers,
} from '@/process/services/modelHub/modelHubService';

type Call = { url: string; body?: unknown };

/** Fake fetch routing by URL; records POST bodies for order assertions. */
function makeFetch(routes: Record<string, unknown>, calls: Call[] = []) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ url, body });
    if (url in routes) {
      return Promise.resolve(new Response(JSON.stringify(routes[url]), { status: 200 }));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
}

beforeEach(() => {
  store.clear();
});

describe('detectServerKind', () => {
  it('detects Ollama via /api/tags', async () => {
    const fetchFn = makeFetch({ 'http://o:11434/api/tags': { models: [] } });
    expect(await detectServerKind('http://o:11434/', fetchFn)).toBe('ollama');
  });

  it('falls back to OpenAI-compatible via /v1/models', async () => {
    const fetchFn = makeFetch({ 'http://lm:1234/v1/models': { data: [] } });
    expect(await detectServerKind('http://lm:1234', fetchFn)).toBe('openai');
  });

  it('throws when neither endpoint responds', async () => {
    await expect(detectServerKind('http://dead:1', makeFetch({}))).rejects.toThrow();
  });
});

describe('addServer / listServers', () => {
  it('registers a server with the detected kind and host as default name', async () => {
    const fetchFn = makeFetch({ 'http://o:11434/api/tags': { models: [] } });
    const result = await addServer({ url: 'http://o:11434/' }, fetchFn);
    expect(result.ok).toBe(true);
    const servers = await listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].kind).toBe('ollama');
    expect(servers[0].name).toBe('o:11434');
    expect(servers[0].url).toBe('http://o:11434');
  });

  it('rejects duplicates and invalid URLs', async () => {
    const fetchFn = makeFetch({ 'http://o:11434/api/tags': { models: [] } });
    await addServer({ url: 'http://o:11434' }, fetchFn);
    expect(await addServer({ url: 'http://o:11434/' }, fetchFn)).toEqual({ ok: false, error: 'duplicate' });
    expect(await addServer({ url: 'ftp://nope' }, fetchFn)).toEqual({ ok: false, error: 'invalid_url' });
  });
});

describe('listAllModels', () => {
  it('aggregates across servers, marks loaded models, flags offline servers', async () => {
    const ollamaFetch = makeFetch({
      'http://o:11434/api/tags': { models: [] },
      'http://lm:1234/v1/models': { data: [] },
    });
    await addServer({ url: 'http://o:11434', name: 'GPU box' }, ollamaFetch);
    await addServer({ url: 'http://lm:1234', name: 'LM Studio' }, ollamaFetch);
    // Third server that will be offline at snapshot time.
    await addServer({ url: 'http://dead:9', name: 'Dead' }, makeFetch({ 'http://dead:9/api/tags': { models: [] } }));

    const snapshotFetch = makeFetch({
      'http://o:11434/api/tags': {
        models: [
          { name: 'llama3:70b', size: 40_000_000_000, details: { family: 'llama' } },
          { name: 'qwen3:8b', size: 5_000_000_000 },
        ],
      },
      'http://o:11434/api/ps': { models: [{ name: 'qwen3:8b' }] },
      'http://lm:1234/v1/models': { data: [{ id: 'mistral-7b-instruct' }] },
    });

    const { servers, models } = await listAllModels(snapshotFetch);

    expect(servers.map((s) => s.online)).toEqual([true, true, false]);
    expect(models.map((m) => m.name)).toEqual(['llama3:70b', 'qwen3:8b', 'mistral-7b-instruct']);
    expect(models.find((m) => m.name === 'qwen3:8b')?.loaded).toBe(true);
    expect(models.find((m) => m.name === 'llama3:70b')?.loaded).toBe(false);
    expect(models.find((m) => m.name === 'mistral-7b-instruct')?.supportsSwap).toBe(false);
  });
});

describe('loadModel (VRAM swap)', () => {
  it('unloads every other resident model before warming the picked one', async () => {
    const setupFetch = makeFetch({ 'http://o:11434/api/tags': { models: [] } });
    const added = await addServer({ url: 'http://o:11434' }, setupFetch);
    if (!added.ok) throw new Error('setup failed');

    const calls: Call[] = [];
    const swapFetch = makeFetch(
      {
        'http://o:11434/api/ps': { models: [{ name: 'llama3:70b' }, { name: 'qwen3:8b' }] },
        'http://o:11434/api/generate': { done: true },
      },
      calls
    );

    const result = await loadModel(added.server.id, 'phi4:14b', swapFetch);
    expect(result).toEqual({ ok: true, loaded: 'phi4:14b', unloaded: ['llama3:70b', 'qwen3:8b'] });

    const generates = calls.filter((c) => c.url.endsWith('/api/generate'));
    // Unloads (keep_alive: 0) strictly precede the warm-up load.
    expect(generates.map((c) => (c.body as { model: string; keep_alive: number | string }).keep_alive)).toEqual([
      0,
      0,
      '30m',
    ]);
    expect((generates[2].body as { model: string }).model).toBe('phi4:14b');
  });

  it('does not unload the picked model when it is already resident', async () => {
    const setupFetch = makeFetch({ 'http://o:11434/api/tags': { models: [] } });
    const added = await addServer({ url: 'http://o:11434' }, setupFetch);
    if (!added.ok) throw new Error('setup failed');

    const calls: Call[] = [];
    const swapFetch = makeFetch(
      {
        'http://o:11434/api/ps': { models: [{ name: 'phi4:14b' }] },
        'http://o:11434/api/generate': { done: true },
      },
      calls
    );
    const result = await loadModel(added.server.id, 'phi4:14b', swapFetch);
    expect(result).toEqual({ ok: true, loaded: 'phi4:14b', unloaded: [] });
    expect(calls.filter((c) => c.url.endsWith('/api/generate'))).toHaveLength(1);
  });

  it('refuses swap on OpenAI-compatible servers and unknown ids', async () => {
    const setupFetch = makeFetch({ 'http://lm:1234/v1/models': { data: [] } });
    const added = await addServer({ url: 'http://lm:1234' }, setupFetch);
    if (!added.ok) throw new Error('setup failed');
    expect(await loadModel(added.server.id, 'x', makeFetch({}))).toEqual({ ok: false, error: 'swap_unsupported' });
    expect(await loadModel('nope', 'x', makeFetch({}))).toEqual({ ok: false, error: 'server_not_found' });
  });
});
