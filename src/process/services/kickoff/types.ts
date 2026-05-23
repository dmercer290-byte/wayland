/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared Kickoff types — main-process side. Mirrors the renderer's
 * AssistantKickoff (src/renderer/pages/settings/AssistantSettings/types.ts)
 * so the IPC contract crosses cleanly without a serde shim.
 */

export type KickoffTimeBucket = 'morning' | 'afternoon' | 'evening';
export type KickoffScenario = 'cold-start' | 'continuation-friendly' | 'post-fire-ritual';

export type KickoffEntry = {
  id: string;
  text: string;
  prefill: string;
  scenario: KickoffScenario;
  timeBucket?: KickoffTimeBucket;
  requiresRitualOutput?: boolean;
  beginnerSafe?: boolean;
};

export type KickoffCascadeLevel = 1 | 2 | 3 | 4;
export type KickoffCascadeReason =
  | 'standing-ritual-fired'
  | 'recent-thread-quality-passed'
  | 'cold-start-library'
  | 'beginner-touch-fallback';

export type NotRenderedReason =
  | 'no-kickoffs-defined'
  | 'unknown-assistant'
  | 'all-levels-missed'
  | 'error';

export type KickoffAlternate = {
  kickoffId: string;
  text: string;
  prefill: string;
};

export type KickoffSuggestion = {
  cascadeLevel: KickoffCascadeLevel;
  cascadeReason: KickoffCascadeReason;
  kickoffId: string;
  text: string;
  prefill: string;
  alternates: KickoffAlternate[];
};

export type KickoffNotRendered = { notRendered: NotRenderedReason };

export type KickoffResult = KickoffSuggestion | KickoffNotRendered;

export type KickoffTelemetryEvent = {
  event: 'accepted' | 'redirected' | 'dismissed' | 'not_rendered';
  kickoffId?: string;
  cascadeLevel?: KickoffCascadeLevel;
  notRenderedReason?: NotRenderedReason;
};

/**
 * Snapshot of all signals SuggestionEngine needs to walk the cascade.
 * Collected by SignalCollector in one main-process pass to avoid the
 * round-trip overhead of querying repos per cascade level.
 */
export type KickoffSignals = {
  now: number;
  timeBucket: KickoffTimeBucket;
  installUuid: string;
  /**
   * Recent conversations scoped to this assistant id, newest-first. Already
   * quality-gate-eligible by source (presetAssistantId match); the engine
   * applies the message-count / duration / auto-title filter itself.
   */
  assistantRecentConversations: Array<{
    id: string;
    modifyTime: number;
    messageCount: number;
    durationMs: number;
    subject: string;
    isAutoTitled: boolean;
  }>;
  /** True iff a Standing-Company ritual cron for this assistant fired ok in the configured window. */
  hasStandingRitualFiredRecently: boolean;
};

export const RITUAL_RECENT_WINDOW_MS = 4 * 60 * 60 * 1000;
export const THREAD_MIN_MESSAGES = 3;
export const THREAD_MIN_DURATION_MS = 2 * 60 * 1000;
