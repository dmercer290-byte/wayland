/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `importEnvKeysOnBoot` connects discovered keys through the model-registry IPC.
// The registry depends on Electron + the database, so it is mocked here and the
// test asserts purely on WHAT `connectModelRegistryProvider` is called with.
const connectMock = vi.fn();
const getRegistryProviderMock = vi.fn();
const getRepoMock = vi.fn();

vi.mock('@process/providers/ipc/modelRegistryIpc', () => ({
  connectModelRegistryProvider: (...args: unknown[]) => connectMock(...args),
  getModelRegistryRepository: () => getRepoMock(),
}));

import { importEnvKeysOnBoot } from '@process/utils/importEnvKeys';

const ORIGINAL_ENV = process.env;

function setEnv(vars: Record<string, string>): void {
  process.env = { ...vars };
}

beforeEach(() => {
  connectMock.mockReset().mockResolvedValue({ ok: true });
  // Default: no provider is already connected, so every discovered key imports.
  getRegistryProviderMock.mockReset().mockReturnValue(undefined);
  getRepoMock.mockReset().mockReturnValue({ getRegistryProvider: getRegistryProviderMock });
  setEnv({});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe('importEnvKeysOnBoot - base URL threading (issue #25)', () => {
  it('threads OPENAI_BASE_URL through as creds.baseUrl (Flux/OpenAI-compatible host)', async () => {
    setEnv({
      OPENAI_API_KEY: 'sk-flux-abc',
      OPENAI_BASE_URL: 'https://api.fluxrouter.ai/v1',
    });

    await importEnvKeysOnBoot();

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith('openai', {
      key: 'sk-flux-abc',
      baseUrl: 'https://api.fluxrouter.ai/v1',
    });
  });

  it('omits baseUrl entirely when no paired *_BASE_URL var is set', async () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-ant-abc' });

    await importEnvKeysOnBoot();

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith('anthropic', { key: 'sk-ant-abc' });
    const creds = connectMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('baseUrl' in creds).toBe(false);
  });

  it('imports moonshot and nvidia keys discovered from the environment (issue #25)', async () => {
    setEnv({ MOONSHOT_API_KEY: 'sk-moon', NVIDIA_API_KEY: 'nvapi-xyz' });

    await importEnvKeysOnBoot();

    const providers = connectMock.mock.calls.map((c) => c[0]).toSorted();
    expect(providers).toEqual(['moonshot', 'nvidia']);
  });

  it('ignores a blank OPENAI_BASE_URL rather than threading an empty baseUrl', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-abc', OPENAI_BASE_URL: '   ' });

    await importEnvKeysOnBoot();

    expect(connectMock).toHaveBeenCalledWith('openai', { key: 'sk-abc' });
  });

  it('skips a provider already connected and never re-imports it', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-abc' });
    getRegistryProviderMock.mockImplementation((id: string) => (id === 'openai' ? { state: 'connected' } : undefined));

    await importEnvKeysOnBoot();

    expect(connectMock).not.toHaveBeenCalled();
  });

  it('retries a provider left in error state', async () => {
    setEnv({ OPENAI_API_KEY: 'sk-abc' });
    getRegistryProviderMock.mockImplementation((id: string) => (id === 'openai' ? { state: 'error' } : undefined));

    await importEnvKeysOnBoot();

    expect(connectMock).toHaveBeenCalledWith('openai', { key: 'sk-abc' });
  });
});
