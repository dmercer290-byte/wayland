/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IO layer for the Local Router: gather what the user can route to, and turn
 * a tier resolution into a concrete forward destination (base URL + key).
 *
 * Candidate sources:
 *  - Model Hub servers (`modelHubService`): keyless local runtimes. Both
 *    Ollama and OpenAI-kind servers expose the OpenAI chat surface under
 *    `<url>/v1`.
 *  - Connected provider rows (`model.config` via `getMergedModelProviders`):
 *    only rows on the OpenAI wire (`openai` / `openai-compatible`) - the v1
 *    router forwards a single wire format. Rows for other wires (anthropic,
 *    bedrock, vertex, gemini) and the router's own row are excluded.
 *
 * Key material is resolved per-request through `hydrateModelForSpawn`, the
 * same registry-hydration path real spawns use, so re-keyed providers are
 * picked up immediately and no secret is cached here.
 */

import { LOCAL_ROUTER_PROVIDER_ID } from '@/common/config/localRouter';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { getMergedModelProviders } from '@process/bridge/modelBridge';
import { hydrateModelForSpawn } from '@process/providers/ipc/modelRegistryIpc';
import { listAllModels, listServers } from '@process/services/modelHub/modelHubService';

import type { ResolvedForward } from './LocalRouterServer';
import type { RouterCandidate, RouterTarget } from './tierResolver';

/** Provider-row platforms the v1 router can forward to (OpenAI wire only). */
const FORWARDABLE_PLATFORMS = new Set(['openai', 'openai-compatible']);

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

/** `hub:<serverId>` marker for Model Hub candidates. */
const HUB_PREFIX = 'hub:';

/** Normalize a base URL to end in `/vN` (append `/v1` when bare). */
export function openAiBase(rawBaseUrl: string): string {
  const base = rawBaseUrl.trim().replace(/\/+$/, '');
  if (/\/v\d+$/i.test(base)) return base;
  return `${base}/v1`;
}

function forwardableRows(providers: IProvider[]): IProvider[] {
  return providers.filter(
    (p) =>
      p.enabled !== false &&
      p.id !== LOCAL_ROUTER_PROVIDER_ID &&
      FORWARDABLE_PLATFORMS.has(p.platform) &&
      (p.platform === 'openai' || Boolean(p.baseUrl))
  );
}

/**
 * Enumerate every model the router could forward to right now. Hub models
 * come first so the fast tier's local preference sees them; per-provider
 * default models are flagged for the standard tier.
 */
export async function gatherCandidates(): Promise<RouterCandidate[]> {
  const out: RouterCandidate[] = [];

  try {
    const snapshot = await listAllModels();
    for (const m of snapshot.models) {
      out.push({
        providerId: `${HUB_PREFIX}${m.serverId}`,
        modelId: m.name,
        source: 'hub',
        loaded: m.loaded,
      });
    }
  } catch (err) {
    console.warn('[LocalRouter] Model Hub enumeration failed:', err instanceof Error ? err.message : err);
  }

  try {
    for (const row of forwardableRows(await getMergedModelProviders())) {
      const models = Array.isArray(row.model) ? row.model : [];
      const defaultModel = (row as { useModel?: string }).useModel || models[0];
      for (const modelId of models.length > 0 ? models : defaultModel ? [defaultModel] : []) {
        out.push({
          providerId: row.id,
          modelId,
          source: 'provider',
          isProviderDefault: modelId === defaultModel,
        });
      }
    }
  } catch (err) {
    console.warn('[LocalRouter] provider enumeration failed:', err instanceof Error ? err.message : err);
  }

  return out;
}

/**
 * Resolve a routing decision into the forward destination. Returns `null`
 * when the target vanished between resolution and dispatch (server removed,
 * provider disconnected) - the caller surfaces that as a router error.
 */
export async function resolveForwardTarget(target: RouterTarget): Promise<ResolvedForward | null> {
  if (target.providerId.startsWith(HUB_PREFIX)) {
    const serverId = target.providerId.slice(HUB_PREFIX.length);
    const server = (await listServers()).find((s) => s.id === serverId);
    if (!server) return null;
    return { baseUrl: openAiBase(server.url), modelId: target.modelId };
  }

  const row = (await getMergedModelProviders()).find((p) => p.id === target.providerId);
  if (!row) return null;
  const binding = { ...row, useModel: target.modelId } as TProviderWithModel;
  const hydrated = await hydrateModelForSpawn(binding);
  const baseUrl = openAiBase(hydrated.baseUrl || (row.platform === 'openai' ? DEFAULT_OPENAI_BASE : ''));
  if (!baseUrl) return null;
  return {
    baseUrl,
    ...(hydrated.apiKey ? { apiKey: hydrated.apiKey } : {}),
    modelId: target.modelId,
  };
}
