import { describe, it, expect } from 'vitest';
import { isAllowedForRemote } from '@/common/adapter/bridgeAllowlist';

/**
 * Audit C4: the model-registry secret/write IPC must NOT be reachable by a
 * remote (paired-device WebSocket) caller. `resolveForChatStart` returns a
 * decrypted plaintext provider key; `connect`/`rekey`/`detectKeys` mutate or
 * disclose stored credentials. A paired WebUI proving a paired browser (not the
 * local trusted user) must be rejected for all four.
 *
 * Each wire key below is the exact string passed to buildProvider() in
 * ipcBridge.ts; the dispatcher receives it as `subscribe-<key>`.
 */
describe('isAllowedForRemote - model-registry secret/write IPC denied', () => {
  const deniedKeys: ReadonlyArray<string> = [
    'modelRegistry.connect',
    'modelRegistry.rekey',
    'modelRegistry.detectKeys',
    'modelRegistry.resolveForChatStart',
  ];

  it.each(deniedKeys)('denies %s for remote callers', (key) => {
    expect(isAllowedForRemote(`subscribe-${key}`)).toBe(false);
  });

  // Sanity: read-only registry providers the paired WebUI legitimately needs
  // stay allowed (denylist, not whitelist).
  const allowedKeys: ReadonlyArray<string> = ['modelRegistry.list', 'modelRegistry.getCatalog'];

  it.each(allowedKeys)('still allows read-only %s for remote callers', (key) => {
    expect(isAllowedForRemote(`subscribe-${key}`)).toBe(true);
  });
});
