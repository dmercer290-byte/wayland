/**
 * Unit tests for FIX B provider-key auto-invalidation decision logic.
 *
 * The load-bearing safety property: NEVER disable a valid provider on a
 * transient error, and when an auth failure IS real, disable ONLY the provider
 * whose injected key matches the failing backend's auth var (a claude spawn also
 * injects openai/google keys, and those must be untouched).
 */
import { describe, it, expect } from 'vitest';
import { isProviderKeyAuthFailure, selectAuthFailureCulprits } from '@/process/providers/detection/authFailure';

describe('isProviderKeyAuthFailure', () => {
  it('matches unambiguous API-key auth failures', () => {
    for (const s of [
      'Internal error: Invalid API key · Fix external API key',
      'invalid api key',
      'HTTP 401 Unauthorized',
      'authentication_error: invalid x-api-key',
      '{"type":"invalid_api_key"}',
      'Request failed: 401',
    ]) {
      expect(isProviderKeyAuthFailure(s)).toBe(true);
    }
  });

  it('does NOT match transient / non-auth errors (no false-positive invalidation)', () => {
    for (const s of [
      '',
      '429 Too Many Requests',
      'rate limit exceeded',
      '500 Internal Server Error',
      'network error: ECONNRESET',
      'socket hang up',
      'model not found',
      'The agent could not complete this request.',
      'process exited unexpectedly (code: 1)',
      'timeout',
    ]) {
      expect(isProviderKeyAuthFailure(s)).toBe(false);
    }
  });
});

describe('selectAuthFailureCulprits', () => {
  const injected = [
    { providerId: 'anthropic' as const, envVars: ['ANTHROPIC_API_KEY'] },
    { providerId: 'openai' as const, envVars: ['OPENAI_API_KEY'] },
    { providerId: 'google' as const, envVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
  ];

  it('invalidates ONLY the provider matching the failing backend auth var', () => {
    // claude auth var = ANTHROPIC_API_KEY → only anthropic, never openai/google.
    const culprits = selectAuthFailureCulprits('Invalid API key', ['ANTHROPIC_API_KEY'], injected);
    expect(culprits).toEqual(['anthropic']);
  });

  it('returns nothing for a non-auth error even if a key was injected', () => {
    expect(selectAuthFailureCulprits('429 rate limit', ['ANTHROPIC_API_KEY'], injected)).toEqual([]);
  });

  it('returns nothing when the backend has no known auth var', () => {
    expect(selectAuthFailureCulprits('Invalid API key', [], injected)).toEqual([]);
  });

  it('returns nothing when no provider key was injected', () => {
    expect(selectAuthFailureCulprits('Invalid API key', ['ANTHROPIC_API_KEY'], [])).toEqual([]);
  });

  it('does not invalidate a provider whose key is not the failing backend var', () => {
    // codex failed on OPENAI_API_KEY but only anthropic was injected → no match.
    const onlyAnthropic = [{ providerId: 'anthropic' as const, envVars: ['ANTHROPIC_API_KEY'] }];
    expect(selectAuthFailureCulprits('Invalid API key', ['OPENAI_API_KEY', 'CODEX_API_KEY'], onlyAnthropic)).toEqual(
      []
    );
  });
});
