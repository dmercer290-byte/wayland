/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW_MS, classifyRunError } from '@/process/services/cron/rateLimitClassifier';

const NOW = 1_751_500_000_000;

describe('classifyRunError', () => {
  it('ignores ordinary errors', () => {
    expect(classifyRunError('ECONNREFUSED 127.0.0.1:443', NOW)).toEqual({ kind: 'other' });
    expect(classifyRunError(undefined, NOW)).toEqual({ kind: 'other' });
    expect(classifyRunError('invalid api key', NOW)).toEqual({ kind: 'other' });
  });

  it('classifies short-window hits with the 5h default reset', () => {
    const result = classifyRunError('429 Too Many Requests: rate limit exceeded', NOW);
    expect(result).toEqual({ kind: 'rate_limit', scope: 'window', retryAtMs: NOW + DEFAULT_WINDOW_MS });
  });

  it('classifies Claude/Gemini usage-limit messages as window hits', () => {
    const result = classifyRunError('You have reached your usage limit for this period.', NOW);
    expect(result.kind).toBe('rate_limit');
    if (result.kind === 'rate_limit') expect(result.scope).toBe('window');
  });

  it('parses relative reset times', () => {
    const result = classifyRunError('Rate limit exceeded. Try again in 2 hours.', NOW);
    expect(result).toEqual({ kind: 'rate_limit', scope: 'window', retryAtMs: NOW + 2 * 3_600_000 });

    const minutes = classifyRunError('quota exceeded - resets in 30 minutes', NOW);
    expect(minutes).toEqual({ kind: 'rate_limit', scope: 'window', retryAtMs: NOW + 30 * 60_000 });
  });

  it('parses Retry-After seconds', () => {
    const result = classifyRunError('429 rate limit; retry-after: 3600', NOW);
    expect(result).toEqual({ kind: 'rate_limit', scope: 'window', retryAtMs: NOW + 3_600_000 });
  });

  it('classifies weekly caps as weekly scope', () => {
    const result = classifyRunError('You have exceeded your weekly usage limit.', NOW);
    expect(result.kind).toBe('rate_limit');
    if (result.kind === 'rate_limit') {
      expect(result.scope).toBe('weekly');
      expect(result.retryAtMs).toBe(NOW + 7 * 24 * 3_600_000);
    }
  });

  it('7-day phrasing also counts as weekly', () => {
    const result = classifyRunError('rate limit: 7-day quota exceeded', NOW);
    if (result.kind !== 'rate_limit') throw new Error('expected rate_limit');
    expect(result.scope).toBe('weekly');
  });
});
