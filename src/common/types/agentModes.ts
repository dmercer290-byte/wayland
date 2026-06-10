/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { CODEX_MODE_FULL_AUTO } from '@/common/types/codex/codexModes';

/**
 * Full-auto (YOLO) mode ID per backend.
 * Shared by renderer (cron task creation) and process (SessionLifecycle).
 */
const FULL_AUTO_MODE: Record<string, string> = {
  claude: 'bypassPermissions',
  qwen: 'yolo',
  opencode: 'build',
  gemini: 'yolo',
  wcore: 'yolo',
  codex: CODEX_MODE_FULL_AUTO,
  cursor: 'agent',
  snow: 'yolo',
};

/**
 * Get the full-auto mode value for a given backend.
 * Falls back to 'yolo' for unknown backends.
 */
export function getFullAutoMode(backend: string | undefined): string {
  if (!backend) return 'yolo';
  return FULL_AUTO_MODE[backend] || 'yolo';
}

/**
 * ACP session mode that auto-approves file edits while still prompting for
 * commands (Claude's "Accept Edits"). Other ACP backends (Gemini/WCore) enforce
 * their own auto-edit mode at the manager layer; this constant covers the ACP
 * `session/set_mode` modeId surfaced by the claude bridge.
 */
const ACP_ACCEPT_EDITS_MODE = 'acceptEdits';

/**
 * Decide whether an ACP permission request should be auto-approved at the manager
 * layer because the session is in "Accept Edits" mode and the tool is a file edit.
 *
 * The claude ACP bridge still forwards a `session/request_permission` for edit
 * tools even after `session/set_mode` -> `acceptEdits`, so Wayland must honor the
 * mode itself (mirroring GeminiAgentManager.autoEdit and WCoreManager.auto_edit).
 * Read/execute tools are intentionally NOT auto-approved here: the "Accept Edits"
 * contract is "auto-approve file edits, prompt for commands".
 *
 * @param mode - The current ACP session mode (e.g. 'default', 'acceptEdits').
 * @param toolKind - The ACP toolCall.kind (e.g. 'edit', 'read', 'execute').
 * @returns true when the edit should be auto-approved without prompting.
 */
export function shouldAutoApproveAcpEdit(mode: string | undefined, toolKind: string | undefined): boolean {
  return mode === ACP_ACCEPT_EDITS_MODE && toolKind === 'edit';
}
