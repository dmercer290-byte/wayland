/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { IModelRegistryProviderView } from '@/common/adapter/ipcBridge';
import type { UseModelRegistry } from '@renderer/hooks/useModelRegistry';

const registryMock = vi.hoisted(() => ({ value: {} as Partial<UseModelRegistry> }));

vi.mock('@renderer/hooks/useModelRegistry', () => ({
  useModelRegistry: () => registryMock.value,
}));

import { useProviderReadiness } from '@renderer/hooks/useProviderReadiness';

function provider(over: Partial<IModelRegistryProviderView>): IModelRegistryProviderView {
  return {
    providerId: 'openai',
    connectedVia: 'key',
    state: 'connected',
    modelCount: 3,
    ...over,
  } as IModelRegistryProviderView;
}

function setRegistry(over: Partial<UseModelRegistry>): void {
  registryMock.value = {
    providers: [],
    loading: false,
    error: null,
    ...over,
  } as Partial<UseModelRegistry>;
}

describe('useProviderReadiness', () => {
  it('reports not-ready with reason "no-provider" when no providers are connected', () => {
    setRegistry({ providers: [] });
    const { result } = renderHook(() => useProviderReadiness());
    expect(result.current.ready).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.reason).toBe('no-provider');
  });

  it('reports ready when at least one provider is connected with no blocking error', () => {
    setRegistry({ providers: [provider({ state: 'connected' })] });
    const { result } = renderHook(() => useProviderReadiness());
    expect(result.current.ready).toBe(true);
    expect(result.current.reason).toBeUndefined();
  });

  it('treats a "testing" provider as ready (transient, not a blocking error)', () => {
    setRegistry({ providers: [provider({ state: 'testing', modelCount: 0 })] });
    const { result } = renderHook(() => useProviderReadiness());
    expect(result.current.ready).toBe(true);
  });

  it('reports not-ready with reason "all-errored" when every provider is errored', () => {
    setRegistry({
      providers: [
        provider({ providerId: 'openai', state: 'error', error: 'unauthorized' }),
        provider({ providerId: 'anthropic', state: 'error', error: 'no-credit' }),
      ],
    });
    const { result } = renderHook(() => useProviderReadiness());
    expect(result.current.ready).toBe(false);
    expect(result.current.reason).toBe('all-errored');
  });

  it('is ready when one provider is healthy even if another is errored', () => {
    setRegistry({
      providers: [
        provider({ providerId: 'openai', state: 'error', error: 'unauthorized' }),
        provider({ providerId: 'anthropic', state: 'connected' }),
      ],
    });
    const { result } = renderHook(() => useProviderReadiness());
    expect(result.current.ready).toBe(true);
    expect(result.current.reason).toBeUndefined();
  });

  it('treats a connected provider carrying a blocking error as errored', () => {
    setRegistry({ providers: [provider({ state: 'connected', error: 'no-credit' })] });
    const { result } = renderHook(() => useProviderReadiness());
    expect(result.current.ready).toBe(false);
    expect(result.current.reason).toBe('all-errored');
  });

  it('reports loading and never ready while the registry list is in flight', () => {
    setRegistry({ providers: [], loading: true });
    const { result } = renderHook(() => useProviderReadiness());
    expect(result.current.loading).toBe(true);
    expect(result.current.ready).toBe(false);
    expect(result.current.reason).toBeUndefined();
  });
});
