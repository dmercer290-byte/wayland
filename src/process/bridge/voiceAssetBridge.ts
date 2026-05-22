/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { ipcBridge } from '@/common';
import { VoiceAssetManager } from '@process/services/voice/VoiceAssetManager';
import { resolveVoiceAsset } from '@process/services/voice/voiceAssetRegistry';

export function initVoiceAssetBridge(): void {
  ipcBridge.voiceAsset.download.provider(async (asset) => {
    // Enrich renderer-supplied descriptor with server-known destPath +
    // pinned sha256 before handing it to the downloader. Empty fields on
    // the inbound asset get filled from the registry; non-empty fields are
    // preserved (test overrides + future extension assets).
    const resolved = resolveVoiceAsset(asset);
    return VoiceAssetManager.download(resolved);
  });
  ipcBridge.voiceAsset.cancel.provider(async ({ assetId }) => ({
    cancelled: VoiceAssetManager.cancel(assetId),
  }));
  ipcBridge.voiceAsset.exists.provider(async ({ id }) => {
    // Build a minimal descriptor; resolveVoiceAsset returns the canonical
    // destPath from the registry. If id is unknown the resolved path will
    // be empty and existsSync('') returns false — same outcome.
    const resolved = resolveVoiceAsset({ id, url: '', destPath: '', sha256: '' });
    if (!resolved.destPath) return { installed: false, destPath: null };
    return { installed: existsSync(resolved.destPath), destPath: resolved.destPath };
  });
}
