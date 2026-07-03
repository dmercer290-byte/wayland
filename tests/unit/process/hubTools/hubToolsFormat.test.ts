/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { formatCostReport, formatHubList, formatLoadResult, resolveServerRef } from '@/process/hubTools/hubToolsFormat';
import type { HubModel, HubServerStatus } from '@/process/services/modelHub/modelHubService';

const servers: HubServerStatus[] = [
  { id: 's1', name: 'GPU box', url: 'http://gpu:11434', kind: 'ollama', online: true },
  { id: 's2', name: 'LM Studio', url: 'http://mac:1234', kind: 'openai', online: false, error: 'HTTP 502' },
];

const models: HubModel[] = [
  {
    serverId: 's1',
    serverName: 'GPU box',
    kind: 'ollama',
    name: 'qwen3:8b',
    sizeBytes: 5e9,
    loaded: true,
    supportsSwap: true,
  },
  {
    serverId: 's1',
    serverName: 'GPU box',
    kind: 'ollama',
    name: 'llama3:70b',
    sizeBytes: 4e10,
    loaded: false,
    supportsSwap: true,
  },
];

describe('formatHubList', () => {
  it('groups models under servers with status and VRAM badges', () => {
    const out = formatHubList(servers, models);
    expect(out).toContain('GPU box — ollama — online');
    expect(out).toContain('LM Studio — openai — OFFLINE (HTTP 502)');
    expect(out).toContain('qwen3:8b (4.7 GB) [IN VRAM]');
    expect(out).toContain('llama3:70b (37.3 GB)');
    expect(out).toContain('(unreachable)');
  });

  it('explains how to register when empty', () => {
    expect(formatHubList([], [])).toContain('No model servers registered');
  });
});

describe('formatLoadResult', () => {
  it('reports the swap with freed models', () => {
    const out = formatLoadResult({ ok: true, loaded: 'phi4:14b', unloaded: ['qwen3:8b'] }, 'GPU box');
    expect(out).toContain('Loaded phi4:14b');
    expect(out).toContain('unloading: qwen3:8b');
  });

  it('explains unsupported swap on OpenAI-compatible servers', () => {
    const out = formatLoadResult({ ok: false, error: 'swap_unsupported' }, 'LM Studio');
    expect(out).toContain('only Ollama servers');
  });
});

describe('formatCostReport', () => {
  it('formats totals and per-model rows', () => {
    const out = formatCostReport('in the last 7 days', { costUsd: 12.345, tokensTotal: 2_500_000, events: 210 }, [
      { key: 'claude-sonnet-5', costUsd: 9.1, tokensTotal: 1_800_000, events: 150 },
      { key: '', costUsd: 3.2, tokensTotal: 700_000, events: 60 },
    ]);
    expect(out).toContain('$12.35 · 2.5M tokens · 210 turns');
    expect(out).toContain('- claude-sonnet-5: $9.10 · 1.8M tokens');
    expect(out).toContain('(unattributed)');
  });

  it('says so when there is no usage', () => {
    expect(formatCostReport('today', { costUsd: 0, tokensTotal: 0, events: 0 }, [])).toContain(
      'No recorded API usage today'
    );
  });
});

describe('resolveServerRef', () => {
  it('matches by id, name (case-insensitive), and URL fragment', () => {
    expect(resolveServerRef(servers, 's2')?.name).toBe('LM Studio');
    expect(resolveServerRef(servers, 'gpu box')?.id).toBe('s1');
    expect(resolveServerRef(servers, 'mac:1234')?.id).toBe('s2');
  });

  it('falls back to the only server, never guesses among many', () => {
    expect(resolveServerRef([servers[0]], 'anything')?.id).toBe('s1');
    expect(resolveServerRef(servers, 'nonexistent')).toBeUndefined();
    expect(resolveServerRef(servers, '')).toBeUndefined();
  });
});
