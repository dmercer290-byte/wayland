import type { RawModel } from '../types';

/**
 * A catalog source emits the raw model list for a single provider. Concrete
 * sources back the three discovery paths in the Models & Providers redesign:
 *
 * - `api`   — a cloud provider's `/v1/models` endpoint
 * - `wcore` — the Wayland Core model list
 * - `cli`   — a local CLI agent's exposed models
 *
 * The raw models are later enriched by the models.dev registry into
 * `CatalogModel[]`.
 */
export type CatalogSource = {
  readonly kind: 'api' | 'wcore' | 'cli';
  readonly providerId: string;
  listModels(): Promise<RawModel[]>;
};
