/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tier resolution for the Local Router: map a virtual tier model
 * (`router-auto` / `router-fast` / `router-standard` / `router-reasoning`)
 * to one concrete target the user actually has - a connected
 * openai-compatible provider model or a Model Hub server model.
 *
 * Policy (deterministic, zero-config; overrides win when present):
 *  - reasoning: first candidate whose model id looks like a reasoning model
 *    (o-series, r1, qwq, `*-thinking`, ...); else the standard pick.
 *  - fast: a VRAM-loaded Model Hub model first, then any hub model, then a
 *    cloud model whose id looks small/fast; else the standard pick.
 *  - standard: the first enabled provider row's currently selected model;
 *    else the first candidate of any kind.
 *  - auto: alias of standard in v1 (no per-request scoring yet).
 *
 * Pure functions only - candidates are gathered by the caller
 * (`routerSingleton`), so this file needs no IO and is fully unit-testable.
 */

import type { LocalRouterModelId, LocalRouterTierOverrides } from '@/common/config/localRouter';

/** One routable model the user has. */
export type RouterCandidate = {
  /** Model-config row id, or `hub:<serverId>` for Model Hub models. */
  providerId: string;
  /** Concrete model id to send upstream. */
  modelId: string;
  /** `hub` = keyless local server; `provider` = connected provider row. */
  source: 'hub' | 'provider';
  /** Hub only: currently resident in VRAM. */
  loaded?: boolean;
  /** Provider only: this row's currently selected (default) model. */
  isProviderDefault?: boolean;
};

/** A resolved routing decision. */
export type RouterTarget = {
  providerId: string;
  modelId: string;
  source: 'hub' | 'provider';
  via: 'override' | 'auto';
};

const REASONING_RE = /(^|[^a-z])o[0-9]+\b|reason|thinking|qwq|(^|[^a-z0-9])r1\b|deepseek-r/i;
const FAST_RE = /mini|flash|small|haiku|lite|nano|fast|turbo|\b[3-9]b\b/i;

function toTarget(c: RouterCandidate, via: RouterTarget['via']): RouterTarget {
  return { providerId: c.providerId, modelId: c.modelId, source: c.source, via };
}

function standardPick(candidates: RouterCandidate[]): RouterCandidate | undefined {
  return candidates.find((c) => c.source === 'provider' && c.isProviderDefault) ?? candidates[0];
}

/**
 * Resolve one tier against the candidate list. Returns `null` when the user
 * has nothing routable connected (the server surfaces that as a clear error).
 */
export function resolveTier(
  tier: LocalRouterModelId,
  candidates: RouterCandidate[],
  overrides: LocalRouterTierOverrides = {}
): RouterTarget | null {
  const override = overrides[tier];
  if (override) {
    const match = candidates.find((c) => c.providerId === override.providerId && c.modelId === override.modelId);
    // An override naming something no longer connected falls through to the
    // automatic policy rather than hard-failing the request.
    if (match) return toTarget(match, 'override');
  }

  if (candidates.length === 0) return null;

  switch (tier) {
    case 'router-reasoning': {
      const reasoning = candidates.find((c) => REASONING_RE.test(c.modelId));
      const pick = reasoning ?? standardPick(candidates);
      return pick ? toTarget(pick, 'auto') : null;
    }
    case 'router-fast': {
      const pick =
        candidates.find((c) => c.source === 'hub' && c.loaded) ??
        candidates.find((c) => c.source === 'hub') ??
        candidates.find((c) => FAST_RE.test(c.modelId)) ??
        standardPick(candidates);
      return pick ? toTarget(pick, 'auto') : null;
    }
    case 'router-auto':
    case 'router-standard': {
      const pick = standardPick(candidates);
      return pick ? toTarget(pick, 'auto') : null;
    }
  }
}
