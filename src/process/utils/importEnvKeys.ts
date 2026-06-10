/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boot-time provider-key import for the standalone (headless) server.
 *
 * In Electron the Models page lets a user paste keys interactively. A headless
 * server has no such UI, so on boot we scan the environment (and the same
 * well-known CLI config files the desktop scans) for provider API keys and
 * persist any we find into the model registry - the same connect+test+catalog
 * path the interactive "Use discovered key" button runs. Without this, valid
 * keys present in the container env never reach the registry and the Models page
 * stays empty (issue #25).
 *
 * Idempotent: a provider already `connected` in the registry is skipped, so a
 * restart never re-imports or clobbers a working connection. A provider in an
 * `error` state IS retried (the key may have been fixed). Key material is never
 * logged - only provider ids and counts.
 */

import { KeyDiscovery } from '@process/providers/detection/KeyDiscovery';
import {
  connectModelRegistryProvider,
  getModelRegistryRepository,
} from '@process/providers/ipc/modelRegistryIpc';

/**
 * Discover provider keys from the environment and persist them into the model
 * registry. Never throws - any failure is logged and import continues with the
 * next provider so a single bad key cannot crash boot.
 */
export async function importEnvKeysOnBoot(): Promise<void> {
  const repo = getModelRegistryRepository();
  if (!repo) {
    // initModelRegistryIpc must run before this. If the repo is missing the
    // registry IPC was never wired; nothing to import into.
    console.warn('[server] Skipping env-key import: model registry not initialized');
    return;
  }

  const discovery = new KeyDiscovery();
  const found = await discovery.scan();
  if (found.length === 0) return;

  let imported = 0;
  for (const key of found) {
    try {
      // Skip providers already connected - don't re-import or overwrite a
      // working connection on every restart. Retry providers left in `error`.
      const existing = repo.getRegistryProvider(key.providerId);
      if (existing && existing.state === 'connected') continue;

      const value = discovery.readValue(key);
      if (!value) continue; // source vanished between scan() and readValue()

      const result = await connectModelRegistryProvider(key.providerId, { key: value });
      if (result.ok) {
        imported += 1;
        // Provider id only - never the key value.
        console.log(`[server] Imported provider key from environment: ${key.providerId}`);
      } else {
        console.warn(`[server] Env key for ${key.providerId} failed to connect: ${result.error}`);
      }
    } catch (error) {
      console.warn(`[server] Failed to import env key for ${key.providerId}:`, error);
    }
  }

  if (imported > 0) {
    console.log(`[server] Imported ${imported} provider key(s) from the environment`);
  }
}
