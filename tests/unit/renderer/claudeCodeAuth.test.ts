/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { isClaudeCodeOAuthRejection } from '@/renderer/pages/conversation/platforms/acp/claudeCodeAuth';

describe('isClaudeCodeOAuthRejection', () => {
  const signatures = [
    'Invalid API key',
    'createSession returned null',
    'authentication failed',
    '认证失败',
    '[ACP-AUTH-401] rejected',
    'OAuth token rejected by Anthropic',
    'Request was unauthorized',
    'HTTP 401',
  ];

  it.each(signatures)('returns true for claude + %s', (errorMsg) => {
    expect(isClaudeCodeOAuthRejection('claude', errorMsg)).toBe(true);
  });

  it('returns false for claude + an unrelated error', () => {
    expect(isClaudeCodeOAuthRejection('claude', 'network timeout while reading file')).toBe(false);
  });

  it('does not hijack a non-claude backend with the same error', () => {
    expect(isClaudeCodeOAuthRejection('qwen', 'invalid api key')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isClaudeCodeOAuthRejection('claude', 'INVALID API KEY')).toBe(true);
    expect(isClaudeCodeOAuthRejection('claude', 'CreateSession Failed')).toBe(true);
    expect(isClaudeCodeOAuthRejection('claude', 'UNAUTHORIZED')).toBe(true);
  });
});
