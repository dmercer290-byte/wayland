/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfigStorage } from '@/common/config/storage';
import { QUICK_LAUNCH_ANCHORS } from '@/renderer/pages/guid/quickLaunchAnchors';
import type { LaunchpadBarOrder } from '@/common/types/launchpad';

/**
 * Default bar order - the anchors that shipped in v0.5.0. New installs
 * see exactly this set on first boot. Customisation is opt-in: once the
 * user reorders / adds / removes a card the resulting array is persisted
 * to ConfigStorage under `launchpad.barOrder`, and the default branch is
 * never taken again on that install (even if the user manually empties
 * the bar - `[]` is still a deliberate user choice).
 */
export const DEFAULT_BAR_ORDER: LaunchpadBarOrder = QUICK_LAUNCH_ANCHORS.map((a) => a.assistantId);

/**
 * Always-available cards. A pinned id is ALWAYS present in the bar: it is
 * injected at its canonical slot even when the user's persisted order predates
 * it (existing installs that customised the bar before Concierge shipped) or
 * tried to drop it, and `removeFromBar` refuses to remove it. Concierge is the
 * universal "ask anything" entry point and must always be reachable from the
 * launchpad, so it sits at slot 1 - the #2 card, right after Cowork.
 */
export const PINNED_BAR_IDS: readonly string[] = ['builtin-concierge'];

/** Canonical insert slot per pinned id (index into the bar). Concierge = #2 card. */
const PINNED_SLOTS: Readonly<Record<string, number>> = { 'builtin-concierge': 1 };

/**
 * Ensure every PINNED_BAR_IDS entry is present in `order`, inserting any missing
 * one at its canonical slot (clamped to the current length). Ids already present
 * keep their position. Pure: returns the same reference when nothing changed so
 * callers can cheaply detect a no-op.
 */
export function ensurePinned(order: LaunchpadBarOrder): LaunchpadBarOrder {
  let next = order;
  for (const id of PINNED_BAR_IDS) {
    if (next.includes(id)) continue;
    if (next === order) next = [...order];
    const slot = Math.min(PINNED_SLOTS[id] ?? next.length, next.length);
    next.splice(slot, 0, id);
  }
  return next;
}

/**
 * Hard cap on bar entries. The bar replaces the launchpad cold-start row
 * on /guid; without a cap the picker would let users stack 50+ cards and
 * obliterate the page. 10 is the product ceiling - picker disables further
 * adds once the cap is hit (LaunchpadPicker renders a banner + dims the
 * unpinned cards).
 */
export const LAUNCHPAD_MAX_ENTRIES = 10;

const STORAGE_KEY = 'launchpad.barOrder' as const;

export type UseLaunchpadBarReturn = {
  /** Current ordered bar. Empty array until the initial load finishes. */
  barOrder: LaunchpadBarOrder;
  /** True until the first ConfigStorage read resolves. */
  loaded: boolean;
  /** Replace the entire order (e.g. dnd-kit drop). Persists through to ConfigStorage. */
  setBarOrder: (next: LaunchpadBarOrder) => void;
  /** Append an assistant ID if not already present. */
  addToBar: (assistantId: string) => void;
  /** Remove an assistant ID from the bar. */
  removeFromBar: (assistantId: string) => void;
  /** Reset to the default set (overwrites any user customisation). */
  resetToDefaults: () => void;
};

/**
 * Hook that owns the editable launchpad bar order. Single source of
 * truth across the three mount points (launchpad / /assistants /
 * Settings). On mount it reads `launchpad.barOrder` from ConfigStorage:
 *
 *   - `undefined` / unset      → seed with DEFAULT_BAR_ORDER (in-memory
 *     only; nothing is written until the user touches the bar).
 *   - non-empty array          → use as-is.
 *   - empty array              → respect the user's deliberate empty bar.
 *
 * Either way, PINNED_BAR_IDS (Concierge) are injected so the always-available
 * cards survive a persisted order that predates or removed them.
 *
 * `setBarOrder` / `addToBar` / `removeFromBar` write through to
 * ConfigStorage. The hook deliberately does NOT validate IDs against
 * the live assistant catalogue - that is the responsibility of the
 * renderer (which silently skips unknown IDs at draw time so an
 * extension reinstall restores its card).
 */
export function useLaunchpadBar(): UseLaunchpadBarReturn {
  const [barOrder, setBarOrderState] = useState<LaunchpadBarOrder>([]);
  const [loaded, setLoaded] = useState(false);
  // Tracks whether the user has touched the bar since boot. While
  // `false` the in-memory default is rendered but NOT persisted; the
  // first mutation flips this and every subsequent change writes
  // through. Prevents the default from being eagerly written to every
  // fresh install (which would be a meaningless write and would mask
  // future default-set upgrades).
  const userMutatedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void ConfigStorage.get(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (Array.isArray(stored)) {
          // Even an empty array is a deliberate user state - but pinned cards
          // (Concierge) are always injected so they survive a persisted order
          // that predates them or removed them. Injected in-memory only; the
          // re-injection is idempotent on every load, so we don't silently
          // rewrite the user's stored config here.
          setBarOrderState(ensurePinned(stored));
          userMutatedRef.current = true;
        } else {
          setBarOrderState(ensurePinned(DEFAULT_BAR_ORDER));
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[useLaunchpadBar] failed to read bar order; falling back to defaults', err);
        setBarOrderState(ensurePinned(DEFAULT_BAR_ORDER));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: LaunchpadBarOrder) => {
    // Pinned cards (Concierge) are re-asserted on every explicit write, so a
    // drag-reorder or reset can never leave the bar without them.
    const pinned = ensurePinned(next);
    userMutatedRef.current = true;
    setBarOrderState(pinned);
    void ConfigStorage.set(STORAGE_KEY, pinned).catch((err) => {
      console.warn('[useLaunchpadBar] failed to persist bar order', err);
    });
  }, []);

  const setBarOrder = useCallback(
    (next: LaunchpadBarOrder) => {
      persist(next);
    },
    [persist]
  );

  const addToBar = useCallback(
    (assistantId: string) => {
      setBarOrderState((prev) => {
        if (prev.includes(assistantId)) return prev;
        if (prev.length >= LAUNCHPAD_MAX_ENTRIES) {
          console.warn(
            '[useLaunchpadBar] bar at cap (%d); refusing to add %s',
            LAUNCHPAD_MAX_ENTRIES,
            assistantId
          );
          return prev;
        }
        const next = [...prev, assistantId];
        userMutatedRef.current = true;
        void ConfigStorage.set(STORAGE_KEY, next).catch((err) => {
          console.warn('[useLaunchpadBar] failed to persist bar order', err);
        });
        return next;
      });
    },
    []
  );

  const removeFromBar = useCallback(
    (assistantId: string) => {
      if (PINNED_BAR_IDS.includes(assistantId)) {
        console.warn('[useLaunchpadBar] refusing to remove pinned card %s', assistantId);
        return;
      }
      setBarOrderState((prev) => {
        const next = prev.filter((id) => id !== assistantId);
        if (next.length === prev.length) return prev;
        userMutatedRef.current = true;
        void ConfigStorage.set(STORAGE_KEY, next).catch((err) => {
          console.warn('[useLaunchpadBar] failed to persist bar order', err);
        });
        return next;
      });
    },
    []
  );

  const resetToDefaults = useCallback(() => {
    persist([...DEFAULT_BAR_ORDER]);
  }, [persist]);

  return {
    barOrder,
    loaded,
    setBarOrder,
    addToBar,
    removeFromBar,
    resetToDefaults,
  };
}
