/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/config/storage';
import { useCallback, useMemo } from 'react';
import useSWR from 'swr';

/** SWR key for the persisted hidden-agent set (single source of truth). */
export const HIDDEN_AGENTS_SWR_KEY = 'agents.hidden';

/**
 * Shared, reactive view of the agent keys the user hid from the Guid-page
 * agent toolbar strip.
 *
 * Backed by `ConfigStorage('agents.hidden')` through a single SWR cache key, so
 * the Agents settings page (where the user toggles an agent off) and the Guid
 * page (which filters the toolbar) stay in sync without a reload: a toggle
 * writes storage then revalidates the shared key, re-rendering every consumer.
 *
 * Keys use the same format as `getAgentKey` (plain backend, `custom:uuid`, or
 * `remote:uuid`). An absent or empty list means every detected agent is shown.
 */
export function useHiddenAgents() {
  const { data, mutate } = useSWR<string[]>(HIDDEN_AGENTS_SWR_KEY, async () => {
    const stored = await ConfigStorage.get('agents.hidden');
    return stored ?? [];
  });

  const hidden = useMemo(() => data ?? [], [data]);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  const isHidden = useCallback((agentKey: string) => hiddenSet.has(agentKey), [hiddenSet]);

  /**
   * Show or hide a single agent in the toolbar strip and persist the change.
   * `hide === true` removes the agent from the strip; `false` restores it.
   */
  const setAgentHidden = useCallback(
    async (agentKey: string, hide: boolean) => {
      const current = (await ConfigStorage.get('agents.hidden')) ?? [];
      const next = hide
        ? current.includes(agentKey)
          ? current
          : [...current, agentKey]
        : current.filter((key) => key !== agentKey);
      await ConfigStorage.set('agents.hidden', next);
      // Bound mutate (not the global import) so every consumer of this key in
      // the same SWR cache scope - including a separately-mounted page - revalidates.
      await mutate(next, { revalidate: false });
    },
    [mutate]
  );

  return { hidden, hiddenSet, isHidden, setAgentHidden };
}
