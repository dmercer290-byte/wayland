/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `wcoreToolKeys` IPC handlers (WS-2 P2).
 *
 * Renderer-facing surface for the engine's web-search tool-backend API keys
 * (Brave / Tavily / Exa / Firecrawl). Wraps {@link getToolKeyStore}, which
 * persists each key encrypted-at-rest through the model-registry creds rail.
 * Once a key is stored, `buildEngineSpawnEnv` forwards it into the engine spawn
 * env on the next spawn - this surface only stores / reports presence / clears.
 *
 * SECURITY - HUMAN/RENDERER ONLY: these handlers read and mutate credential
 * material for the engine's tool sandbox. They must be reachable ONLY from the
 * trusted renderer acting on direct human intent, and must NEVER be exposed to
 * the agent/engine tool surface. A prompt-injection payload that could call
 * `wcoreToolKeys.set` could plant an attacker-controlled search key; one that
 * could read a key would exfiltrate a secret. Accordingly:
 *  - `list` returns PRESENCE ONLY (`{ id, hasKey }[]`) - the plaintext key is
 *    NEVER returned to the renderer (mirrors how `modelRegistry` never sends key
 *    material to the renderer).
 *  - `set` / `delete` are credential-mutating providers; they are added to the
 *    remote denylist (`bridgeAllowlist.ts`) so a paired WebUI client cannot
 *    reach them.
 */

import { ipcBridge } from '@/common';
import type { IWcoreToolKeyPresence } from '@/common/adapter/ipcBridge';
import { getToolKeyStore, TOOL_KEY_ENV_MAP } from './toolKeyStore';
import type { ToolKeyId } from './toolKeyStore';

/** The canonical tool ids, derived from the env map so the two cannot drift. */
const TOOL_KEY_IDS = Object.keys(TOOL_KEY_ENV_MAP) as ToolKeyId[];

/** Type-guard: is `id` one of the supported tool-backend ids? */
function isToolKeyId(id: string): id is ToolKeyId {
  return (TOOL_KEY_IDS as string[]).includes(id);
}

/**
 * The store slice the handlers depend on - declared structurally so tests can
 * supply an in-memory fake without the async singleton + native DB.
 */
export type ToolKeyStoreSlice = {
  setToolKey: (id: ToolKeyId, key: string) => void;
  getToolKey: (id: ToolKeyId) => string | undefined;
  deleteToolKey: (id: ToolKeyId) => void;
};

/** The three `wcoreToolKeys` handler functions, keyed by contract method name. */
export type WcoreToolKeyHandlers = {
  set: (p: { id: string; key: string }) => Promise<{ ok: boolean }>;
  list: () => Promise<IWcoreToolKeyPresence[]>;
  delete: (p: { id: string }) => Promise<{ ok: boolean }>;
};

/**
 * Build the `wcoreToolKeys` handlers over an injected store. Exported so unit
 * tests exercise the real handler logic (including the presence-only invariant)
 * without the IPC layer. The store is resolved lazily per call in production so
 * a DB that is not yet ready does not crash registration.
 */
export function createWcoreToolKeyHandlers(getStore: () => Promise<ToolKeyStoreSlice>): WcoreToolKeyHandlers {
  return {
    async set({ id, key }): Promise<{ ok: boolean }> {
      try {
        if (!isToolKeyId(id)) return { ok: false };
        const trimmed = typeof key === 'string' ? key.trim() : '';
        if (trimmed.length === 0) return { ok: false };
        const store = await getStore();
        store.setToolKey(id, trimmed);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },

    async list(): Promise<IWcoreToolKeyPresence[]> {
      try {
        const store = await getStore();
        // Presence ONLY - the plaintext key never crosses to the renderer.
        return TOOL_KEY_IDS.map((id) => ({ id, hasKey: store.getToolKey(id) !== undefined }));
      } catch {
        // On any failure report no keys present rather than throwing - the pane
        // degrades to "not connected" instead of an error screen.
        return TOOL_KEY_IDS.map((id) => ({ id, hasKey: false }));
      }
    },

    async delete({ id }): Promise<{ ok: boolean }> {
      try {
        if (!isToolKeyId(id)) return { ok: false };
        const store = await getStore();
        store.deleteToolKey(id);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
  };
}

/**
 * Wire the human-only `wcoreToolKeys.set` / `.list` / `.delete` IPC handlers
 * over the production {@link getToolKeyStore} singleton.
 *
 * SECURITY: see the module-level note - these are HUMAN/RENDERER ONLY and must
 * never reach the agent tool surface. The orchestrator wires this into the
 * central IPC registrar.
 */
export function initWcoreToolKeyIpc(): void {
  const h = createWcoreToolKeyHandlers(() => getToolKeyStore());
  ipcBridge.wcoreToolKeys.set.provider((payload) => h.set(payload));
  ipcBridge.wcoreToolKeys.list.provider(() => h.list());
  ipcBridge.wcoreToolKeys.delete.provider((payload) => h.delete(payload));
}
