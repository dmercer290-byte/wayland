/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { classifyAcpAuthFailure } from './acpAuthFailure';

/** True when an ACP error is the Anthropic-blocks-subscription-OAuth rejection for Claude Code. */
export function isClaudeCodeOAuthRejection(backend: string, errorMsg: string): boolean {
  return backend === 'claude' && classifyAcpAuthFailure(backend, errorMsg) !== null;
}
