/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CatalogAssembler — the join stage of the two-tier model store.
 *
 * Takes the `CatalogSource[]` (each emitting `RawModel[]` off a provider's
 * `/v1/models`, the Wayland Core list, or a CLI agent) plus the already-fetched
 * models.dev `ModelsDevRegistry`, and produces the persisted `CatalogModel[]`.
 *
 * For each `RawModel` it looks up the matching models.dev model and either:
 *  - enriches it (`enriched: true`) — display name, family, release date,
 *    context window, cost, and `kind` all come from models.dev; or
 *  - leaves it unenriched (`enriched: false`) — `displayName` is humanized from
 *    the id, `family` is derived from the id, and `kind` defaults to `'text'`.
 *
 * The assembler does NOT fetch the registry — `ModelsDevClient` (Packet 1A)
 * does that and the registry is passed in. The only I/O here is each source's
 * `listModels()`; a source that throws is caught, skipped, and the assemble
 * continues with the rest.
 */

import type { CatalogSource } from '../sources/CatalogSource';
import type { ModelsDevModel, ModelsDevRegistry } from '../enrichment/modelsDevSchema';
import type { CatalogModel, ModelKind, ProviderId, RawModel } from '../types';
import { ModelDisplayNames } from './ModelDisplayNames';

/**
 * Maps our `ProviderId` to the provider key models.dev uses in its registry.
 *
 * models.dev keys providers by its own ids, which differ from ours in a few
 * cases — most notably Google: our `google-gemini` is models.dev's `google`.
 * Verified against `resources/modelsdev-snapshot.json` (2026-05-22, 134
 * providers). A provider absent from this map falls back to a flat id scan
 * across every models.dev provider.
 */
const MODELS_DEV_PROVIDER_KEY: Partial<Record<ProviderId, string>> = {
  anthropic: 'anthropic',
  openai: 'openai',
  'google-gemini': 'google',
  'aws-bedrock': 'amazon-bedrock',
  vertex: 'google-vertex',
  azure: 'azure',
  openrouter: 'openrouter',
  groq: 'groq',
  xai: 'xai',
  mistral: 'mistral',
  cohere: 'cohere',
  perplexity: 'perplexity',
  together: 'togetherai',
  fireworks: 'fireworks-ai',
  cerebras: 'cerebras',
  huggingface: 'huggingface',
  nvidia: 'nvidia',
  deepseek: 'deepseek',
  moonshot: 'moonshotai',
  qwen: 'alibaba',
  'zhipu-glm': 'zhipuai',
  minimax: 'minimax',
};

export class CatalogAssembler {
  private readonly displayNames = new ModelDisplayNames();

  /**
   * Assemble the full catalog from every source, enriched by the registry.
   *
   * Calls each source's `listModels()` in parallel; a source that rejects is
   * skipped (it contributes nothing) without aborting the others. Every
   * collected `RawModel` becomes a `CatalogModel`.
   */
  async assemble(sources: CatalogSource[], registry: ModelsDevRegistry): Promise<CatalogModel[]> {
    const settled = await Promise.allSettled(sources.map((source) => source.listModels()));

    const catalog: CatalogModel[] = [];
    for (const result of settled) {
      // A rejected source contributes nothing — degrade per-source, never abort.
      if (result.status !== 'fulfilled') continue;
      for (const raw of result.value) {
        catalog.push(this.toCatalogModel(raw, registry));
      }
    }
    return catalog;
  }

  /** Enrich one `RawModel` against the registry into a `CatalogModel`. */
  private toCatalogModel(raw: RawModel, registry: ModelsDevRegistry): CatalogModel {
    const match = findModelsDevModel(raw, registry);

    if (!match) {
      // Unmatched — humanized name, id-derived family, safe text default.
      return {
        id: raw.id,
        providerId: raw.providerId,
        displayName: this.displayNames.humanise(raw.id, raw.providerId),
        family: deriveFamily(raw.id),
        kind: 'text',
        enriched: false,
      };
    }

    // Matched — every enriched field comes from the models.dev entry.
    const model: CatalogModel = {
      id: raw.id,
      providerId: raw.providerId,
      displayName: match.name,
      family: match.family ?? deriveFamily(raw.id),
      kind: deriveKind(match),
      enriched: true,
    };
    if (match.release_date) model.releaseDate = match.release_date;
    if (match.limit?.context !== undefined) model.contextWindow = match.limit.context;
    if (match.cost?.input !== undefined) model.costInPerM = match.cost.input;
    if (match.cost?.output !== undefined) model.costOutPerM = match.cost.output;
    return model;
  }
}

// ─── Join ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the models.dev model entry for a `RawModel`.
 *
 * First tries the mapped models.dev provider key (an exact, fast lookup). If the
 * provider is unmapped, or the model id is not under the mapped provider, falls
 * back to a flat scan of every models.dev provider for a model with that id.
 */
function findModelsDevModel(raw: RawModel, registry: ModelsDevRegistry): ModelsDevModel | null {
  const devKey = MODELS_DEV_PROVIDER_KEY[raw.providerId];
  if (devKey) {
    const direct = registry[devKey]?.models[raw.id];
    if (direct) return direct;
  }

  // Fallback: an unmapped provider, or a model the mapped provider does not
  // carry — scan every provider for a model with this exact id.
  for (const provider of Object.values(registry)) {
    const model = provider.models[raw.id];
    if (model) return model;
  }
  return null;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Derive a `ModelKind` from a models.dev model.
 *
 * `modalities.output` carries `image`/`audio` for those model kinds. Embedding
 * models are NOT distinguishable by modality — they declare a `text` output
 * like a chat model — so they are detected by name (`family`/`id` containing
 * `embed`). Everything else is `text`.
 */
function deriveKind(model: ModelsDevModel): ModelKind {
  const output = model.modalities?.output ?? [];
  if (output.includes('image')) return 'image';
  if (output.includes('audio')) return 'audio';
  if (looksLikeEmbedding(model)) return 'embedding';
  return 'text';
}

/** True when a model's name/family/id reads like an embedding model. */
function looksLikeEmbedding(model: ModelsDevModel): boolean {
  const haystack = `${model.family ?? ''} ${model.id}`.toLowerCase();
  return haystack.includes('embed');
}

/**
 * Derive a stable family from a model id when models.dev does not supply one.
 *
 * Strips trailing version and date tokens so different generations of the same
 * model collapse into one family (`claude-sonnet-4-20250101` → `claude-sonnet`).
 * If stripping removes everything, the full id is returned — a singleton family
 * the Curator still surfaces as its own flagship.
 *
 * Tokens stripped from the END only (a leading numeric token is part of the
 * family name, e.g. `gpt-4`-style ids keep their version when it is not
 * trailing):
 *  - a date: `YYYYMMDD` or `YYYY-MM-DD`
 *  - a version: `vN`, `vN.N`, a 3-digit Vertex suffix (`001`), a bare number,
 *    or a dotted number (`4.1`)
 *  - common variant words at the tail (`latest`, `preview`, `exp`, etc.)
 */
function deriveFamily(modelId: string): string {
  // Drop a vendor path prefix so it never leaks into the family name.
  let id = modelId.replace(/^(anthropic\.|meta\.|models\/)/, '');

  // A model id may carry a provider route prefix (`liquid/lfm-2`) — the family
  // is derived from the final path segment.
  const slash = id.lastIndexOf('/');
  if (slash !== -1) id = id.slice(slash + 1);

  const tokens = id.split('-');
  while (tokens.length > 1 && isTrailingNoiseToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  const family = tokens.join('-');
  return family.length > 0 ? family : id;
}

/** True when a trailing id token is a version, date, or variant word to strip. */
function isTrailingNoiseToken(token: string): boolean {
  const t = token.toLowerCase();
  // A date: 8 digits (YYYYMMDD) — single-token form of a date suffix.
  if (/^\d{8}$/.test(t)) return true;
  // A version: a bare number, a dotted number, or a v-prefixed number.
  if (/^v?\d+(\.\d+)?$/.test(t)) return true;
  // A common trailing variant word.
  return ['latest', 'preview', 'exp', 'experimental', 'beta', 'stable', 'thinking'].includes(t);
}
