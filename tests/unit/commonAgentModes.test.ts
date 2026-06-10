/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { getFullAutoMode, shouldAutoApproveAcpEdit } from '@/common/types/agentModes';

describe('shouldAutoApproveAcpEdit', () => {
  it('auto-approves edit tools in acceptEdits mode', () => {
    expect(shouldAutoApproveAcpEdit('acceptEdits', 'edit')).toBe(true);
  });

  it('does NOT auto-approve execute tools in acceptEdits mode', () => {
    expect(shouldAutoApproveAcpEdit('acceptEdits', 'execute')).toBe(false);
  });

  it('does NOT auto-approve read tools in acceptEdits mode', () => {
    expect(shouldAutoApproveAcpEdit('acceptEdits', 'read')).toBe(false);
  });

  it('does NOT auto-approve edits in default mode', () => {
    expect(shouldAutoApproveAcpEdit('default', 'edit')).toBe(false);
  });

  it('does NOT auto-approve edits in plan mode', () => {
    expect(shouldAutoApproveAcpEdit('plan', 'edit')).toBe(false);
  });

  it('handles undefined mode and kind without throwing', () => {
    expect(shouldAutoApproveAcpEdit(undefined, 'edit')).toBe(false);
    expect(shouldAutoApproveAcpEdit('acceptEdits', undefined)).toBe(false);
  });
});

describe('getFullAutoMode', () => {
  it('returns bypassPermissions for claude', () => {
    expect(getFullAutoMode('claude')).toBe('bypassPermissions');
  });

  it('falls back to yolo for unknown backends', () => {
    expect(getFullAutoMode('unknown-backend')).toBe('yolo');
    expect(getFullAutoMode(undefined)).toBe('yolo');
  });
});
