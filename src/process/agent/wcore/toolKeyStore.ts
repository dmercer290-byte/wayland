/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Encrypted-at-rest storage for tool-backend API keys (web-search providers).
 *
 * Rather than add a parallel encryption boundary, this reuses the existing
 * model-registry creds rail: each tool key is persisted through
 * {@link ProviderRepository} under a `tool:<id>` provider id, encrypted by the
 * same OS-keychain-backed `safeStorage` path as every other credential. The
 * `ProviderId` type was widened (T0.1) to accept arbitrary string ids, so
 * `tool:brave` is a valid key with no new table or migration.
 *
 * The forwarded env var NAME for each id (see {@link TOOL_KEY_ENV_MAP}) is
 * chosen so its uppercased form always contains one of the engine sandbox's
 * secret markers (`API_KEY`, …). That is what keeps a forwarded key OUT of the
 * agent's bash-tool context after it is injected into the engine spawn env
 * (SEC-5).
 */

import { ProviderRepository } from '@process/providers/storage/ProviderRepository';
import type { ProviderId } from '@process/providers/types';

/**
 * Canonical tool id → forwarded engine-spawn env var NAME.
 *
 * Each NAME must contain an engine-sandbox secret marker (every entry here
 * contains `API_KEY`) so the engine strips it from the agent's tool context.
 * Adding a backend whose natural env var lacks a marker (e.g. a bare
 * `*_URL`) requires aliasing it to a `*_API_KEY` name - never forward an
 * unmarked secret.
 */
export const TOOL_KEY_ENV_MAP = {
  // Web search
  brave: 'BRAVE_SEARCH_API_KEY',
  tavily: 'TAVILY_API_KEY',
  exa: 'EXA_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  // Voice & audio (engine tool_backends: tts.rs / voice_mode.rs)
  elevenlabs: 'ELEVENLABS_API_KEY',
  groq: 'GROQ_API_KEY',
  // Image generation (engine tool_backend: image_gen.rs - FAL FLUX / HF FLUX)
  fal: 'FAL_API_KEY',
  huggingface: 'HF_API_KEY',
} as const satisfies Record<string, string>;

/** A supported tool-backend id. */
export type ToolKeyId = keyof typeof TOOL_KEY_ENV_MAP;

/** Provider-id namespace under which tool keys live in `model_registry_providers`. */
const TOOL_PROVIDER_PREFIX = 'tool:';

/** Map a tool id onto its namespaced registry provider id. */
function toolProviderId(id: ToolKeyId): ProviderId {
  return `${TOOL_PROVIDER_PREFIX}${id}`;
}

/**
 * Thin synchronous adapter over {@link ProviderRepository} for tool-backend
 * keys. Repository operations are synchronous (better-sqlite3); only acquiring
 * the driver is async, which is why {@link getToolKeyStore} resolves the
 * singleton lazily while these methods stay sync.
 */
export class ToolKeyStore {
  constructor(private readonly repo: ProviderRepository) {}

  /** Store (insert or replace) the encrypted key for a tool backend. */
  setToolKey(id: ToolKeyId, key: string): void {
    this.repo.upsertRegistryProvider({
      providerId: toolProviderId(id),
      connectedVia: 'tool-key',
      state: 'connected',
      creds: { key },
    });
  }

  /** The decrypted key for a tool backend, or `undefined` when not stored. */
  getToolKey(id: ToolKeyId): string | undefined {
    const result = this.repo.getRegistryProviderCreds(toolProviderId(id));
    if (result.status !== 'ok') return undefined;
    const key = result.creds.key;
    return typeof key === 'string' && key.length > 0 ? key : undefined;
  }

  /** Remove a stored tool-backend key. */
  deleteToolKey(id: ToolKeyId): void {
    this.repo.deleteRegistryProvider(toolProviderId(id));
  }

  /**
   * Build the `{ ENV_NAME: value }` map of every present tool key, ready to
   * merge into the engine spawn env. Absent keys are omitted, so the engine
   * never sees an empty/placeholder var.
   */
  collectForwardedEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, envName] of Object.entries(TOOL_KEY_ENV_MAP) as [ToolKeyId, string][]) {
      const key = this.getToolKey(id);
      if (key !== undefined) out[envName] = key;
    }
    return out;
  }
}

/** Lazily-resolved process-wide singleton, bound to the app database. */
let cachedStore: ToolKeyStore | null = null;

/**
 * Resolve the shared {@link ToolKeyStore}, binding it to the app database on
 * first use. Async only because acquiring the SQLite driver is async; the
 * returned store's methods are all synchronous.
 */
export async function getToolKeyStore(): Promise<ToolKeyStore> {
  if (cachedStore) return cachedStore;
  const { getDatabase } = await import('@process/services/database');
  const db = await getDatabase();
  cachedStore = new ToolKeyStore(new ProviderRepository(db.getDriver()));
  return cachedStore;
}
