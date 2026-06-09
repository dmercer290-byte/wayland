/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useModelRegistry } from '@renderer/hooks/useModelRegistry';
import type { IModelRegistryProviderView } from '@/common/adapter/ipcBridge';

/**
 * Why the engine's agents are still asleep, when no working inference provider
 * is configured.
 *
 * - `no-provider`  - nothing is connected at all.
 * - `all-errored`  - one or more providers are connected, but every one is in
 *   an error state / carries a blocking connect error.
 */
export type ProviderReadinessReason = 'no-provider' | 'all-errored';

export type ProviderReadiness = {
  /** True once at least one connected provider can serve inference. */
  ready: boolean;
  /** True while the underlying provider list is still loading. */
  loading: boolean;
  /** Why agents are asleep - only set when `ready` is false and not loading. */
  reason?: ProviderReadinessReason;
};

/**
 * A provider is "working" when it is not in an error connection state and
 * carries no blocking connect error. The renderer cannot read API keys (they
 * never cross the process boundary), so readiness is derived purely from the
 * provider STATE the model registry exposes - not from key presence.
 *
 * `state: 'testing'` is transient (a connectivity probe is in flight) and is
 * treated as working as long as no error has been classified yet; the engine
 * already has credentials for it.
 */
function isWorkingProvider(p: IModelRegistryProviderView): boolean {
  return p.state !== 'error' && p.error === undefined;
}

/**
 * Reports whether a working inference provider is configured, so the in-thread
 * activation card can decide whether to wake the engine or keep agents asleep.
 *
 * Consumes the same `listProviders` surface as {@link useModelRegistry} - no
 * new IPC. Readiness = "at least one provider in a connected/ready state with
 * no blocking error".
 */
export function useProviderReadiness(): ProviderReadiness {
  const { providers, loading } = useModelRegistry();

  return useMemo<ProviderReadiness>(() => {
    if (loading) {
      return { ready: false, loading: true };
    }
    if (providers.length === 0) {
      return { ready: false, loading: false, reason: 'no-provider' };
    }
    const ready = providers.some(isWorkingProvider);
    if (ready) {
      return { ready: true, loading: false };
    }
    return { ready: false, loading: false, reason: 'all-errored' };
  }, [providers, loading]);
}
