/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider } from '@/common/config/storage';
import { isFluxModelId } from '@/common/config/flux';

/**
 * Resolve the legacy `IProvider` that owns a model the unified flyout emitted.
 *
 * The flyout reports `(modelId, providerId)` where `providerId` is the model
 * registry's `ProviderId` (e.g. `'openai'`). That is NOT the legacy storage
 * `provider.id` (an opaque per-install id), so matching purely on
 * `p.id === providerId` silently fails for every non-Flux model and the click
 * is swallowed (#99/#102/#103/#104). Resolve robustly instead:
 *
 *  - Flux routing aliases (`flux-auto`, ...): the live Flux provider's id is
 *    opaque AND its tiers are not function_calling models, so match by the raw
 *    `provider.model` catalog (NOT the function-calling-filtered
 *    `getAvailableModels`, which would exclude them).
 *  - Everything else: try the exact id first (cheap, correct when registry and
 *    storage ids happen to align), then fall back to the membership join - the
 *    provider whose available models actually include this `modelId`. That join
 *    is the same identity `useWCoreModelSelection` uses for its stale-model
 *    check, so `modelId` is guaranteed to align with `getAvailableModels`.
 *
 * Returns `undefined` only when no connected provider offers the model.
 */
export const resolveSelectedProvider = (
  providers: IProvider[],
  getAvailableModels: (provider: IProvider) => string[],
  modelId: string,
  providerId: string
): IProvider | undefined => {
  if (isFluxModelId(modelId)) {
    return providers.find((p) => (p.model ?? []).some((m) => isFluxModelId(m)));
  }
  return (
    providers.find((p) => p.id === providerId) ??
    providers.find((p) => getAvailableModels(p).includes(modelId))
  );
};
