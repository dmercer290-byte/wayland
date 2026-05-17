/**
 * @license
 * Copyright 2025 Wayland (TradeCanyon)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verifies WhatsAppPlugin.resolveBridgeEntryPath() picks the right location
 * for dev vs packaged Electron builds. Regression guard for the production
 * ENOENT we hit when the bridge wasn't bundled into the app at all (v0.2.0).
 *
 * Packaged: bridge ships under <process.resourcesPath>/whatsapp-bridge/
 *           via electron-builder extraResources, so the fork path must point
 *           there — anything inside app.asar throws ENOENT for fork().
 * Dev:     bridge lives in the source tree relative to this file's compiled
 *           location; resolution must end with whatsapp-bridge/bridge.js.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `electron` is mocked per-test via vi.doMock so we can flip `isPackaged`
// without re-importing or re-running the whole module graph.
const { isPackagedRef } = vi.hoisted(() => ({
  isPackagedRef: { value: false },
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackagedRef.value;
    },
    getAppPath: () => '/test/app',
  },
}));

// child_process is unused by resolveBridgeEntryPath but the module imports it
// at top-level. Stub so vitest does not pull in the real implementation.
vi.mock('child_process', () => ({
  fork: vi.fn(),
  ChildProcess: class {},
}));

describe('WhatsAppPlugin.resolveBridgeEntryPath', () => {
  const originalResourcesPath = process.resourcesPath;

  beforeEach(() => {
    vi.resetModules();
    isPackagedRef.value = false;
    Object.defineProperty(process, 'resourcesPath', {
      value: '/test/resources',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('resolves to <process.resourcesPath>/whatsapp-bridge/bridge.js when packaged', async () => {
    isPackagedRef.value = true;
    const mod = await import('@process/channels/plugins/tier1/whatsapp/WhatsAppPlugin');
    const resolved = mod.resolveBridgeEntryPath();
    expect(resolved).toBe('/test/resources/whatsapp-bridge/bridge.js');
  });

  it('resolves to the source-tree path in dev (isPackaged=false)', async () => {
    isPackagedRef.value = false;
    const mod = await import('@process/channels/plugins/tier1/whatsapp/WhatsAppPlugin');
    const resolved = mod.resolveBridgeEntryPath();
    expect(resolved.endsWith('whatsapp-bridge/bridge.js')).toBe(true);
    expect(resolved).not.toContain('/test/resources/');
    // Walks up from the WhatsAppPlugin source location; must contain the
    // channels segment somewhere upstream.
    expect(resolved).toContain('whatsapp-bridge');
  });
});
