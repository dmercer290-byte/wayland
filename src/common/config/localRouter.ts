/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local Router - the app's own model router (no hosted service).
 *
 * A loopback OpenAI-compatible server (see
 * `src/process/services/router/LocalRouterServer.ts`) resolves the virtual
 * tier models below to the user's OWN connected providers and Model Hub
 * servers, then forwards the request. This file is the renderer-safe shared
 * vocabulary, mirroring `flux.ts` for the hosted Flux Router.
 */

/** Legacy model-config provider id the router registers itself as. */
export const LOCAL_ROUTER_PROVIDER_ID = 'local-router' as const;

/** Default auto-routing tier. */
export const LOCAL_ROUTER_AUTO_MODEL = 'router-auto' as const;

/** The four selectable tiers, auto first. Order is the picker order. */
export const LOCAL_ROUTER_MODEL_IDS = ['router-auto', 'router-reasoning', 'router-standard', 'router-fast'] as const;

export type LocalRouterModelId = (typeof LOCAL_ROUTER_MODEL_IDS)[number];

/** Human labels for the picker. */
export const LOCAL_ROUTER_MODEL_DISPLAY: Record<LocalRouterModelId, string> = {
  'router-auto': 'Router Auto',
  'router-reasoning': 'Router Reasoning',
  'router-standard': 'Router Standard',
  'router-fast': 'Router Fast',
};

export function isLocalRouterProvider(providerId: string | undefined | null): boolean {
  return providerId === LOCAL_ROUTER_PROVIDER_ID;
}

export function isLocalRouterModelId(modelId: string | undefined | null): modelId is LocalRouterModelId {
  return typeof modelId === 'string' && (LOCAL_ROUTER_MODEL_IDS as readonly string[]).includes(modelId);
}

/**
 * Optional per-tier override persisted at ProcessConfig `router.tierOverrides`:
 * `{ [tier]: { providerId, modelId } }`. `providerId` is a model-config row id,
 * or `hub:<serverId>` for a Model Hub server. Absent tiers use the automatic
 * policy - the router works with zero configuration.
 */
export type LocalRouterTierOverride = { providerId: string; modelId: string };
export type LocalRouterTierOverrides = Partial<Record<LocalRouterModelId, LocalRouterTierOverride>>;
