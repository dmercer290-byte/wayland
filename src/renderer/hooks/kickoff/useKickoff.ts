/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  KickoffResult,
  KickoffSuggestion,
  KickoffTelemetryEvent,
} from '@process/services/kickoff/types';

/**
 * Hook for the new-chat Kickoff card. Consumes the SuggestionEngine's
 * per-assistant suggestion through the kickoff IPC namespace.
 *
 * Behavior:
 *  - On `assistantId` change, fetches a fresh suggestion. If the user
 *    already × dismissed this assistant in the current session, no fetch
 *    runs (per-session in-memory dismiss state, no Settings, no
 *    persistence — see Sean's locked decision #1).
 *  - `accept()` returns the prefill string the input should drop in, fires
 *    `accepted` telemetry, and the caller (KickoffCard via GuidPage)
 *    pipes it into `guidInput.setInput`. Returning the string instead of
 *    side-effecting keeps the hook decoupled from any input store.
 *  - `redirect()` advances through up to 2 alternates, then falls through
 *    to dismiss (the "Something else" ladder cap from handoff §6.8).
 *  - `dismissByInteraction()` is the × button. `dismissByTyping()` is the
 *    silent dismiss the renderer fires when the user starts typing in the
 *    input — same state change, distinct telemetry so v2 analytics can
 *    distinguish "user said no" from "user did not engage with the card."
 */

const dismissedAssistantsThisSession = new Set<string>();

function isSuggestion(result: KickoffResult): result is KickoffSuggestion {
  return (result as KickoffSuggestion).cascadeLevel !== undefined;
}

export type UseKickoffReturn = {
  visible: boolean;
  currentText: string | undefined;
  /** Returns the prefill string the input should drop in (or undefined if no suggestion). */
  accept: () => string | undefined;
  redirect: () => void;
  dismissByInteraction: () => void;
  dismissByTyping: () => void;
};

export function useKickoff(assistantId: string | undefined): UseKickoffReturn {
  const [suggestion, setSuggestion] = useState<KickoffSuggestion | null>(null);
  const [alternateIndex, setAlternateIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const lastFetchedFor = useRef<string | undefined>(undefined);

  // Reset card state + (re-)fetch when assistantId changes.
  useEffect(() => {
    if (!assistantId) {
      setSuggestion(null);
      setDismissed(false);
      setAlternateIndex(0);
      return;
    }
    // Per-session dismiss survives unmount/remount of the GuidPage but not a
    // restart. The Set lives at module scope intentionally for that reason.
    if (dismissedAssistantsThisSession.has(assistantId)) {
      setSuggestion(null);
      setDismissed(true);
      setAlternateIndex(0);
      return;
    }
    setDismissed(false);
    setAlternateIndex(0);
    lastFetchedFor.current = assistantId;
    let cancelled = false;
    void ipcBridge.kickoff.suggest
      .invoke({ assistantId })
      .then((result) => {
        if (cancelled || lastFetchedFor.current !== assistantId) return;
        if (isSuggestion(result)) {
          setSuggestion(result);
        } else {
          setSuggestion(null);
          void fireTelemetry({ event: 'not_rendered', notRenderedReason: result.notRendered });
        }
      })
      .catch((err) => {
        console.warn('[useKickoff] suggest IPC failed', err);
        if (!cancelled) setSuggestion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assistantId]);

  const accept = useCallback((): string | undefined => {
    if (!suggestion) return undefined;
    const isPrimary = alternateIndex === 0;
    const alternate = !isPrimary ? suggestion.alternates[alternateIndex - 1] : undefined;
    if (!isPrimary && !alternate) return undefined;
    const acceptedId = isPrimary ? suggestion.kickoffId : alternate!.kickoffId;
    const prefill = isPrimary ? suggestion.prefill : alternate!.prefill;
    void fireTelemetry({
      event: 'accepted',
      kickoffId: acceptedId,
      cascadeLevel: suggestion.cascadeLevel,
    });
    // Mark dismissed once accepted — the card visually clears after the
    // input takes focus, and a stale card sitting behind the typed input
    // would just be visual noise.
    if (assistantId) dismissedAssistantsThisSession.add(assistantId);
    setDismissed(true);
    return prefill;
  }, [alternateIndex, assistantId, suggestion]);

  const redirect = useCallback(() => {
    if (!suggestion) return;
    const remaining = suggestion.alternates.length - alternateIndex;
    if (remaining <= 0) {
      // Ladder exhausted — fall through to bare input.
      if (assistantId) dismissedAssistantsThisSession.add(assistantId);
      setDismissed(true);
      return;
    }
    void fireTelemetry({
      event: 'redirected',
      kickoffId: suggestion.kickoffId,
      cascadeLevel: suggestion.cascadeLevel,
    });
    setAlternateIndex((i) => i + 1);
  }, [alternateIndex, assistantId, suggestion]);

  const dismissByInteraction = useCallback(() => {
    if (suggestion) {
      void fireTelemetry({
        event: 'dismissed',
        kickoffId: suggestion.kickoffId,
        cascadeLevel: suggestion.cascadeLevel,
      });
    }
    if (assistantId) dismissedAssistantsThisSession.add(assistantId);
    setDismissed(true);
  }, [assistantId, suggestion]);

  const dismissByTyping = useCallback(() => {
    // Telemetry kept distinct from the explicit × so v2 analytics can show
    // "card shown but user just started typing" vs "card actively rejected."
    if (suggestion) {
      void fireTelemetry({
        event: 'dismissed',
        kickoffId: suggestion.kickoffId,
        cascadeLevel: suggestion.cascadeLevel,
      });
    }
    if (assistantId) dismissedAssistantsThisSession.add(assistantId);
    setDismissed(true);
  }, [assistantId, suggestion]);

  const visible = !dismissed && suggestion !== null;
  const currentText =
    alternateIndex === 0 ? suggestion?.text : suggestion?.alternates[alternateIndex - 1]?.text;

  return { visible, currentText, accept, redirect, dismissByInteraction, dismissByTyping };
}

function fireTelemetry(event: KickoffTelemetryEvent): Promise<void> {
  return ipcBridge.kickoff.telemetry.invoke(event).catch((err) => {
    console.warn('[useKickoff] telemetry IPC failed', err);
  });
}

/** Test-only — clear the module-scoped per-session dismiss set. */
export function __resetKickoffSessionDismissForTests(): void {
  dismissedAssistantsThisSession.clear();
}
