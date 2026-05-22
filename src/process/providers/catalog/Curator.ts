/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Curator — the pure curation function of the two-tier model store.
 *
 * The assembler produces a full `CatalogModel[]` (every model every source
 * exposes). The Curator derives the much smaller `CuratedModel[]` view the chat
 * model picker shows: the latest model in each family, plus the one revision
 * before it.
 *
 * ## Rules
 *
 * 1. Only `kind === 'text'` models are curated. Image / audio / embedding models
 *    stay in the full catalog for other features but never reach the picker.
 * 2. Text models are grouped by `family`.
 * 3. Within a family, models are ordered newest-first by `releaseDate`. A model
 *    with no `releaseDate` sorts last.
 * 4. The newest model in a family → `recommended: true, enabled: true,
 *    role: 'flagship'`. The second-newest → `recommended: true, enabled: true,
 *    role: 'previous'`. A single-model family yields only a flagship.
 * 5. Every other model → `recommended: false, enabled: false`, no `role`.
 *
 * Fast/cheap families (Haiku, GPT mini, Gemini Flash) are NOT special-cased —
 * they form their own families and are surfaced by exactly the same rule. Cost
 * is deliberately not an input to curation. The `role: 'fast'` value exists in
 * the type for future use but this curator never emits it.
 *
 * This function is genuinely PURE: no network, no filesystem, no `Date.now()`.
 * Given the same input it always returns a deeply equal result, and it never
 * mutates its input.
 */

import type { CatalogModel, CuratedModel } from '../types';

export class Curator {
  /**
   * Derive the curated picker view from the full catalog.
   *
   * Returns one `CuratedModel` per text model in `catalog` (image/audio/
   * embedding models are dropped). The returned array's order groups a family's
   * models together, newest-first; family order itself is not significant.
   */
  curate(catalog: CatalogModel[]): CuratedModel[] {
    const textModels = catalog.filter((model) => model.kind === 'text');
    const families = groupByFamily(textModels);

    const curated: CuratedModel[] = [];
    for (const familyModels of families.values()) {
      const ordered = sortNewestFirst(familyModels);
      ordered.forEach((model, index) => {
        curated.push(curateOne(model, index));
      });
    }
    return curated;
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Group models by `family`, preserving each family's first-seen order. A `Map`
 * keeps iteration deterministic for a given input — required for purity.
 */
function groupByFamily(models: CatalogModel[]): Map<string, CatalogModel[]> {
  const families = new Map<string, CatalogModel[]>();
  for (const model of models) {
    const bucket = families.get(model.family);
    if (bucket) {
      bucket.push(model);
    } else {
      families.set(model.family, [model]);
    }
  }
  return families;
}

/**
 * Sort a family's models newest-first by `releaseDate`. A model without a date
 * sorts after every dated model. The sort is stable on a copy — the input array
 * is never mutated, so the function stays pure.
 */
function sortNewestFirst(models: CatalogModel[]): CatalogModel[] {
  return models.toSorted((a, b) => {
    const aDate = a.releaseDate;
    const bDate = b.releaseDate;
    if (aDate && bDate) return bDate < aDate ? -1 : bDate > aDate ? 1 : 0;
    if (aDate) return -1; // dated model precedes an undated one
    if (bDate) return 1;
    return 0; // both undated — preserve relative order
  });
}

/**
 * Convert a `CatalogModel` into a `CuratedModel` given its rank within its
 * family (0 = newest). Ranks 0 and 1 are recommended; everything else is not.
 */
function curateOne(model: CatalogModel, rank: number): CuratedModel {
  if (rank === 0) {
    return { ...model, recommended: true, enabled: true, role: 'flagship' };
  }
  if (rank === 1) {
    return { ...model, recommended: true, enabled: true, role: 'previous' };
  }
  return { ...model, recommended: false, enabled: false };
}
