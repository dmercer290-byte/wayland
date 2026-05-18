import { useMemo } from 'react';
import {
  recommendBackend,
  resolveAvailableBackends,
  type BackendId,
} from '@process/team/backends/resolveAvailableBackends';
import { useDetectedAgents } from './useDetectedAgents';

/**
 * Renderer-side wrapper around `resolveAvailableBackends` / `recommendBackend`.
 *
 * Bridges `useDetectedAgents()` (which returns `{ availableBackends: AvailableBackend[] }`)
 * into the plain `BackendId[]` shape the pure functions expect.
 */
export function useAvailableBackends() {
  const { availableBackends } = useDetectedAgents();

  const detected = useMemo<BackendId[]>(() => availableBackends.map((b) => b.id), [availableBackends]);

  const available = useMemo<BackendId[]>(() => resolveAvailableBackends(detected), [detected]);

  return {
    available,
    recommend: (presetAgentType?: string) => recommendBackend(detected, presetAgentType),
  };
}
