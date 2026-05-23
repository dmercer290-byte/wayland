/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { kickoffEngine } from '@process/services/kickoff/kickoffSingleton';
import type { KickoffResult, KickoffTelemetryEvent } from '@process/services/kickoff/types';

/**
 * IPC surface for the Kickoff system.
 *
 * Two endpoints:
 *   - suggest({ assistantId })  — main process walks the cascade, returns
 *     KickoffSuggestion | { notRendered: NotRenderedReason }
 *   - telemetry(event)          — fire-and-forget log of accept/redirect/
 *     dismiss/not_rendered with cascade reason. v1 just structured-logs;
 *     remote analytics ships post-v1.
 *
 * Validation: assistantId is bounded (1-128 chars) to avoid pathological
 * payloads. We do NOT throw on bad input — the renderer's `useKickoff`
 * hook treats an `error` notRendered reason as "silently fall through to
 * bare input," which is the same outcome as a real cascade miss.
 */
export function initKickoffBridge(): void {
  ipcBridge.kickoff.suggest.provider(async (raw: unknown): Promise<KickoffResult> => {
    if (!isSuggestParams(raw)) return { notRendered: 'error' };
    try {
      return await kickoffEngine.suggest(raw.assistantId);
    } catch (err) {
      console.warn('[kickoff.suggest] failed; returning notRendered/error', err);
      return { notRendered: 'error' };
    }
  });

  ipcBridge.kickoff.telemetry.provider(async (raw: unknown): Promise<void> => {
    if (!isTelemetryEvent(raw)) return;
    // v1: structured log to console only. Remote sink wires in v2.
    console.log('[kickoff.telemetry]', JSON.stringify(raw));
  });
}

function isSuggestParams(raw: unknown): raw is { assistantId: string } {
  if (!raw || typeof raw !== 'object') return false;
  const id = (raw as { assistantId?: unknown }).assistantId;
  return typeof id === 'string' && id.length > 0 && id.length <= 128;
}

const TELEMETRY_EVENT_NAMES = new Set(['accepted', 'redirected', 'dismissed', 'not_rendered']);

function isTelemetryEvent(raw: unknown): raw is KickoffTelemetryEvent {
  if (!raw || typeof raw !== 'object') return false;
  const e = raw as Record<string, unknown>;
  if (typeof e.event !== 'string' || !TELEMETRY_EVENT_NAMES.has(e.event)) return false;
  if (e.kickoffId !== undefined && typeof e.kickoffId !== 'string') return false;
  if (e.cascadeLevel !== undefined && typeof e.cascadeLevel !== 'number') return false;
  if (e.notRenderedReason !== undefined && typeof e.notRenderedReason !== 'string') return false;
  return true;
}
