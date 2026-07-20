/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { resolveTier, type RouterCandidate } from '@process/services/router/tierResolver';

const hub = (modelId: string, loaded = false): RouterCandidate => ({
  providerId: 'hub:srv1',
  modelId,
  source: 'hub',
  loaded,
});

const provider = (providerId: string, modelId: string, isProviderDefault = false): RouterCandidate => ({
  providerId,
  modelId,
  source: 'provider',
  isProviderDefault,
});

describe('resolveTier', () => {
  it('returns null when nothing is connected', () => {
    expect(resolveTier('router-auto', [])).toBeNull();
    expect(resolveTier('router-reasoning', [])).toBeNull();
  });

  it('standard/auto prefer the provider default model over earlier candidates', () => {
    const candidates = [hub('llama3:8b', true), provider('p1', 'gpt-x-large'), provider('p1', 'gpt-x', true)];
    for (const tier of ['router-auto', 'router-standard'] as const) {
      const target = resolveTier(tier, candidates);
      expect(target).toEqual({ providerId: 'p1', modelId: 'gpt-x', source: 'provider', via: 'auto' });
    }
  });

  it('standard falls back to the first candidate when no provider default exists', () => {
    const target = resolveTier('router-standard', [hub('llama3:8b')]);
    expect(target?.modelId).toBe('llama3:8b');
  });

  it('reasoning picks a reasoning-looking model id over the default', () => {
    const candidates = [provider('p1', 'gpt-x', true), provider('p2', 'deepseek-r1-distill')];
    const target = resolveTier('router-reasoning', candidates);
    expect(target?.modelId).toBe('deepseek-r1-distill');
  });

  it('reasoning falls back to the standard pick when nothing matches', () => {
    const candidates = [provider('p1', 'gpt-x', true), hub('llama3:70b')];
    const target = resolveTier('router-reasoning', candidates);
    expect(target?.modelId).toBe('gpt-x');
  });

  it('fast prefers a VRAM-loaded hub model, then any hub model, then a fast-looking cloud id', () => {
    expect(resolveTier('router-fast', [provider('p1', 'gpt-x-mini'), hub('a'), hub('b', true)])?.modelId).toBe('b');
    expect(resolveTier('router-fast', [provider('p1', 'gpt-x-mini'), hub('a')])?.modelId).toBe('a');
    expect(resolveTier('router-fast', [provider('p1', 'gpt-x', true), provider('p1', 'gpt-x-mini')])?.modelId).toBe(
      'gpt-x-mini'
    );
  });

  it('an override wins over the automatic policy', () => {
    const candidates = [provider('p1', 'gpt-x', true), provider('p2', 'other')];
    const target = resolveTier('router-auto', candidates, {
      'router-auto': { providerId: 'p2', modelId: 'other' },
    });
    expect(target).toEqual({ providerId: 'p2', modelId: 'other', source: 'provider', via: 'override' });
  });

  it('an override naming a disconnected target falls back to the automatic policy', () => {
    const candidates = [provider('p1', 'gpt-x', true)];
    const target = resolveTier('router-auto', candidates, {
      'router-auto': { providerId: 'gone', modelId: 'gone-model' },
    });
    expect(target).toEqual({ providerId: 'p1', modelId: 'gpt-x', source: 'provider', via: 'auto' });
  });
});
