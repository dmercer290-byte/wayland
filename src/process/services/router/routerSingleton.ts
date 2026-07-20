/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Singleton accessor for the Local Router. `initLocalRouterService` is called
 * once on app boot (initBridge, same spot as the hub-tools server): it starts
 * the loopback router and upserts the router's provider row into
 * `model.config` so the four tier models show up in every model picker and
 * ride the existing openai-compatible spawn paths.
 *
 * The row is refreshed on every boot because the port and bearer token are
 * minted per run - a stale row from a previous run self-heals here. The
 * user's own edits to the row (enabled flag, selected tier) are preserved.
 */

import {
  LOCAL_ROUTER_AUTO_MODEL,
  LOCAL_ROUTER_MODEL_IDS,
  LOCAL_ROUTER_PROVIDER_ID,
  isLocalRouterModelId,
  type LocalRouterModelId,
  type LocalRouterTierOverrides,
} from '@/common/config/localRouter';
import type { IProvider } from '@/common/config/storage';
import { ProcessConfig } from '@process/utils/initStorage';

import { LocalRouterServer, type ResolvedForward } from './LocalRouterServer';
import { gatherCandidates, resolveForwardTarget } from './routerCandidates';
import { resolveTier } from './tierResolver';

let _server: LocalRouterServer | null = null;

async function readTierOverrides(): Promise<LocalRouterTierOverrides> {
  try {
    const raw = (await ProcessConfig.get('router.tierOverrides')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: LocalRouterTierOverrides = {};
    for (const [tier, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isLocalRouterModelId(tier) || !value || typeof value !== 'object') continue;
      const { providerId, modelId } = value as { providerId?: unknown; modelId?: unknown };
      if (typeof providerId === 'string' && typeof modelId === 'string' && providerId && modelId) {
        out[tier] = { providerId, modelId };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Tier -> forward destination, composed from resolver + IO layers. */
async function resolveForward(tier: LocalRouterModelId): Promise<ResolvedForward | null> {
  const [candidates, overrides] = await Promise.all([gatherCandidates(), readTierOverrides()]);
  const target = resolveTier(tier, candidates, overrides);
  if (!target) return null;
  const forward = await resolveForwardTarget(target);
  if (forward) {
    console.log(`[LocalRouter] ${tier} -> ${target.modelId} (${target.source}, ${target.via}) at ${forward.baseUrl}`);
  }
  return forward;
}

/** Upsert the router's provider row so the tiers appear in model pickers. */
async function upsertRouterProviderRow(server: LocalRouterServer): Promise<void> {
  const data = (await ProcessConfig.get('model.config')) as unknown;
  const list: IProvider[] = Array.isArray(data) ? (data as IProvider[]) : [];
  const existing = list.find((p) => p.id === LOCAL_ROUTER_PROVIDER_ID);

  const row: IProvider = {
    ...existing,
    id: LOCAL_ROUTER_PROVIDER_ID,
    platform: 'openai-compatible',
    name: 'Local Router',
    baseUrl: server.baseUrl,
    apiKey: server.authToken,
    model: [...LOCAL_ROUTER_MODEL_IDS],
    capabilities: existing?.capabilities ?? [],
    enabled: existing?.enabled ?? true,
  } as IProvider;
  // Keep the user's selected tier when it is still one of ours.
  const useModel = (existing as { useModel?: string } | undefined)?.useModel;
  (row as { useModel?: string }).useModel = isLocalRouterModelId(useModel) ? useModel : LOCAL_ROUTER_AUTO_MODEL;

  const next = existing ? list.map((p) => (p.id === LOCAL_ROUTER_PROVIDER_ID ? row : p)) : [...list, row];
  await ProcessConfig.set('model.config', next);
}

/** Start the router and publish its provider row. Idempotent per app run. */
export async function initLocalRouterService(): Promise<void> {
  if (_server) return;
  const server = new LocalRouterServer(resolveForward);
  await server.start();
  _server = server;
  try {
    await upsertRouterProviderRow(server);
  } catch (error) {
    console.error('[LocalRouter] provider-row upsert failed (router still serving):', error);
  }
}

export function getLocalRouterServer(): LocalRouterServer | null {
  return _server;
}

export async function stopLocalRouterService(): Promise<void> {
  await _server?.stop();
  _server = null;
}
