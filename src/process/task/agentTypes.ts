/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/agentTypes.ts

// 'wcore' targets the Wayland-Core Rust engine. Legacy 'aionrs' alias was
// ripped out in session 4 — there are no production users to migrate.
export type AgentType = 'gemini' | 'acp' | 'openclaw-gateway' | 'nanobot' | 'remote' | 'wcore';
export type AgentStatus = 'pending' | 'running' | 'finished';

export interface BuildConversationOptions {
  /** Force yolo mode (auto-approve all tool calls) */
  yoloMode?: boolean;
  /** Skip task cache — create a new isolated instance */
  skipCache?: boolean;
}
