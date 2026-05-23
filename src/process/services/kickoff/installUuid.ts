/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid } from '@/common/utils';
import { ProcessConfig } from '@process/utils/initStorage';

/**
 * Persistent install-scoped UUID used to seed the SuggestionEngine's
 * deterministic per-day shuffle. The seed shape is
 * `hash(installUuid + assistantId + dateKey)` — without persistent entropy
 * here, every fresh install would collapse to the same shuffle on day 1
 * across the entire user base (cross-audit dealbreaker #1).
 *
 * The value is generated once and stored in ConfigStorage under
 * `app.installUuid`. Subsequent calls within the same process round-trip
 * the cached value so the storage adapter only takes the one write.
 */

let cached: string | null = null;
let inFlight: Promise<string> | null = null;

const INSTALL_UUID_KEY = 'app.installUuid';
const INSTALL_UUID_LENGTH = 32;

export async function getInstallUuid(): Promise<string> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const existing = await ProcessConfig.get(INSTALL_UUID_KEY);
      if (typeof existing === 'string' && existing.length > 0) {
        cached = existing;
        return existing;
      }
    } catch (err) {
      console.warn('[kickoff.installUuid] read failed; will mint fresh', err);
    }

    const fresh = uuid(INSTALL_UUID_LENGTH);
    try {
      await ProcessConfig.set(INSTALL_UUID_KEY, fresh);
    } catch (err) {
      // If the write fails we cache anyway: a session-local UUID still
      // provides per-launch entropy (better than the global-determinism
      // failure mode). Next launch will re-mint and try the write again.
      console.warn('[kickoff.installUuid] write failed; using session-local value', err);
    }
    cached = fresh;
    return fresh;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Test-only — clear cached value so the next call re-reads from ConfigStorage. */
export function __resetInstallUuidCacheForTests(): void {
  cached = null;
  inFlight = null;
}
