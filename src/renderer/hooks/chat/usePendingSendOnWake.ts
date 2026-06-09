/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';
import { ipcBridge } from '@/common';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';

/** Dispatches a send for a conversation - the platform's existing executeCommand. */
export type PendingSendExecutor = (args: { input: string; files: string[] }) => Promise<void>;

export type UsePendingSendOnWakeParams = {
  conversationId: string;
  /** True while no working inference provider is configured (engine asleep). */
  asleep: boolean;
  /** True once a working provider can serve inference (engine awake). */
  ready: boolean;
  /** The platform send dispatcher to replay the held message through on wake. */
  execute: PendingSendExecutor;
};

export type UsePendingSendOnWake = {
  /**
   * Hold a send if the engine is asleep. Returns true when the message was
   * parked (caller must stop), false when the caller should send normally.
   */
  holdIfAsleep: (input: string, files: string[]) => Promise<boolean>;
};

/**
 * WS-4 asleep-engine bridge for a conversation send box.
 *
 * While the engine is asleep (no working inference provider) a send is HELD in
 * the MAIN process (`pendingSend` store) instead of dispatched, and auto-fires
 * exactly once when a provider becomes ready - including after the renderer
 * remounts (e.g. the user navigates to settings to connect a key, then back).
 *
 * The held message body lives only in main-process memory (SEC-8: never the
 * renderer's disk/sessionStorage); this hook observes only the opaque presence
 * flag from `peek` and reclaims the body with an exactly-once `take`.
 */
export function usePendingSendOnWake(params: UsePendingSendOnWakeParams): UsePendingSendOnWake {
  const { conversationId, asleep, ready, execute } = params;
  const executeRef = useLatestRef(execute);
  const firingRef = useRef(false);

  const holdIfAsleep = useCallback(
    async (input: string, files: string[]): Promise<boolean> => {
      if (!asleep) return false;
      await ipcBridge.pendingSend.hold.invoke({ conversationId, message: input, files });
      return true;
    },
    [asleep, conversationId]
  );

  // Auto-fire the held send when the engine is (or becomes) awake. Re-entrancy
  // is guarded locally; `take` is atomic exactly-once in main, so a held body is
  // replayed at most once even across concurrent ready transitions.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      if (firingRef.current) return;
      const { hasPending } = await ipcBridge.pendingSend.peek.invoke({ conversationId });
      if (!hasPending || cancelled) return;
      firingRef.current = true;
      try {
        const taken = await ipcBridge.pendingSend.take.invoke({ conversationId });
        if (taken && !cancelled) {
          await executeRef.current({ input: taken.message, files: taken.files });
        }
      } finally {
        firingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, conversationId, executeRef]);

  return { holdIfAsleep };
}
