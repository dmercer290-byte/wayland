/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reset module + ProcessConfig mocks per test so the cache + storage
// adapter start clean. We mock ProcessConfig at the source — there is no
// public reset hook for the JsonFileBuilder cache layer that ProcessConfig
// uses, and we don't want the test touching real $HOME files.

const storageState: { value?: string } = {};

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(async (key: string) => (key === 'app.installUuid' ? storageState.value : undefined)),
    set: vi.fn(async (key: string, value: string) => {
      if (key === 'app.installUuid') storageState.value = value;
    }),
  },
}));

beforeEach(async () => {
  storageState.value = undefined;
  const mod = await import('@process/services/kickoff/installUuid');
  mod.__resetInstallUuidCacheForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getInstallUuid', () => {
  it('mints a fresh UUID on first call and persists it', async () => {
    const { getInstallUuid } = await import('@process/services/kickoff/installUuid');
    const first = await getInstallUuid();
    expect(typeof first).toBe('string');
    expect(first.length).toBeGreaterThan(0);
    expect(storageState.value).toBe(first);
  });

  it('returns the same value on subsequent calls (cache + storage round-trip)', async () => {
    const { getInstallUuid, __resetInstallUuidCacheForTests } = await import(
      '@process/services/kickoff/installUuid'
    );
    const first = await getInstallUuid();
    __resetInstallUuidCacheForTests();
    const second = await getInstallUuid();
    expect(second).toBe(first);
  });

  it('coalesces concurrent first-call invocations to a single mint', async () => {
    const { getInstallUuid } = await import('@process/services/kickoff/installUuid');
    const [a, b, c] = await Promise.all([getInstallUuid(), getInstallUuid(), getInstallUuid()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
