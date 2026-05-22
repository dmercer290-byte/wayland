/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-time migration of the legacy `model.config` `ProcessConfig` store into
 * the new `model_registry_*` tables (Packet 3B).
 *
 * Wave 3A left two stores coexisting: the legacy `model.config` (an `IProvider[]`
 * blob in `ProcessConfig`, written by the now-deleted `ModelModalContent` flow)
 * and the new `model_registry_*` SQLite tables owned by `modelRegistry`. The
 * transitional bridge (`legacyModelConfigBridge`) mirrored every registry
 * connect/rekey/disconnect into `model.config` so chat-start kept working.
 * This migration flips the relationship: the registry is the source of truth.
 *
 * What it does, in one boot:
 *  1. Reads the legacy `model.config` from the injected `LegacyConfigStore`.
 *  2. For each row that the legacy `ModelModalContent` flow wrote (i.e. NOT
 *     tagged `__waylandModelRegistryBridge: 'v1'`), translates `IProvider` into
 *     `ProviderId` + creds + `CatalogModel[]` and writes a `model_registry_*`
 *     row through the injected `MigrationRepo` slice.
 *  3. Bridge-tagged rows are skipped — they already mirror a registry row.
 *  4. A row whose `platform` cannot be translated (unknown / unsupported) is
 *     skipped with a logged warning. The row's models never become a half-built
 *     catalog the user can't act on.
 *  5. A row whose provider id already exists in the registry is skipped — the
 *     user has already connected that provider through the new Models page and
 *     that connection wins over a legacy import.
 *  6. On any first successful run the idempotency flag
 *     `MIGRATION_FLAG_KEY` is set in the config store; subsequent boots skip
 *     the migration entirely.
 *
 * What it does NOT do:
 *  - It does NOT call `ConnectionTester` or fetch from models.dev. The legacy
 *    row already represents a connection the user established once; we trust
 *    it and let the next `refresh` action re-enrich the catalog naturally.
 *  - It does NOT delete the legacy `model.config`. Other UI surfaces (Gemini
 *    /WCore selectors, `AcpModelSelector`, edit modals) still read it, and
 *    sunsetting them is out of scope for Packet 3B.
 *  - It does NOT migrate `legacy-mirror-failed` state — that discriminator
 *    is removed from `ConnectError` alongside this migration.
 */

import type { IProvider } from '@/common/config/storage';
import type { CatalogModel, ConnectError, ProviderConnState, ProviderId } from '../types';

/** Tag stamped on a `model.config` row by the deleted 3A bridge mirror. */
const BRIDGE_TAG_KEY = '__waylandModelRegistryBridge';
const BRIDGE_TAG_VALUE = 'v1';

/** Idempotency marker stored in `ProcessConfig` after a successful run. */
export const MIGRATION_FLAG_KEY = 'migration.legacyModelConfigToRegistry';

/**
 * The slice of `ProcessConfig` the migration needs. Declared structurally so
 * unit tests inject an in-memory fake — no `ProcessConfig`, no Electron runtime.
 */
export type LegacyConfigStore = {
  get<K extends 'model.config' | typeof MIGRATION_FLAG_KEY>(key: K): Promise<unknown>;
  set<K extends 'model.config' | typeof MIGRATION_FLAG_KEY>(
    key: K,
    value: K extends 'model.config' ? IProvider[] : boolean
  ): Promise<void>;
};

/**
 * The slice of `ProviderRepository` the migration writes through. Declared
 * structurally for the same reason.
 */
export type MigrationRepo = {
  getRegistryProvider: (providerId: ProviderId) => unknown | null;
  upsertRegistryProvider: (params: {
    providerId: ProviderId;
    connectedVia: string;
    state: ProviderConnState;
    error?: ConnectError;
    creds: Record<string, unknown>;
  }) => void;
  replaceRegistryCatalog: (providerId: ProviderId, models: CatalogModel[]) => void;
};

export type MigrationResult = {
  /** True when the migration ran (first boot); false when the flag already set. */
  ran: boolean;
  /** Count of legacy rows successfully translated into registry rows. */
  migrated: number;
  /** Count of bridge-mirrored rows skipped (already in the registry). */
  skippedBridge: number;
  /** Count of rows skipped because the registry already had that provider. */
  skippedExisting: number;
  /** Count of rows skipped because the platform couldn't be translated. */
  skippedUnsupported: number;
  /** Count of rows skipped because cloud creds were incomplete. */
  skippedIncompleteCloud: number;
};

// ─── Legacy `platform` → new `ProviderId` translation ─────────────────────────

/**
 * Maps a legacy `IProvider.platform` string to a new-registry `ProviderId`.
 *
 * The legacy bridge mapped the OTHER direction (`ProviderId` → `platform`); this
 * is its inverse. The `openai-compatible` platform covers a wide range of
 * long-tail providers — we cannot pick a `ProviderId` from `platform` alone for
 * those, so they need `baseUrl`-based fingerprinting (see `mapPlatformToProvider`).
 */
const DIRECT_PLATFORM_MAP: Record<string, ProviderId> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google-gemini',
  'gemini-with-google-auth': 'google-gemini',
  'gemini-vertex-ai': 'vertex',
  bedrock: 'aws-bedrock',
  // The legacy 'custom' / 'new-api' platforms are both user-defined
  // OpenAI-compatible endpoints — they need baseUrl fingerprinting too.
};

/**
 * BaseUrl-substring fingerprints for `openai-compatible` and `custom` /
 * `new-api` legacy rows. Order matters — `openrouter.ai` is more specific than
 * `openai.com`, so it comes first. Each entry is checked against the row's
 * `baseUrl` substring (case-insensitive); the first hit wins.
 *
 * A legacy row with a `baseUrl` that does NOT match any fingerprint is mapped
 * to `'openai-compatible'` — a real provider id in the new registry that
 * preserves the user's `baseUrl` end-to-end.
 */
const BASEURL_FINGERPRINTS: Array<{ host: string; providerId: ProviderId }> = [
  { host: 'openrouter.ai', providerId: 'openrouter' },
  { host: 'api.groq.com', providerId: 'groq' },
  { host: 'api.x.ai', providerId: 'xai' },
  { host: 'api.mistral.ai', providerId: 'mistral' },
  { host: 'api.cohere.com', providerId: 'cohere' },
  { host: 'api.perplexity.ai', providerId: 'perplexity' },
  { host: 'api.together.xyz', providerId: 'together' },
  { host: 'api.fireworks.ai', providerId: 'fireworks' },
  { host: 'api.cerebras.ai', providerId: 'cerebras' },
  { host: 'api.replicate.com', providerId: 'replicate' },
  { host: 'huggingface.co', providerId: 'huggingface' },
  { host: 'integrate.api.nvidia.com', providerId: 'nvidia' },
  { host: 'api.endpoints.anyscale.com', providerId: 'anyscale' },
  { host: 'api.deepseek.com', providerId: 'deepseek' },
  { host: 'api.moonshot.cn', providerId: 'moonshot' },
  { host: 'dashscope.aliyuncs.com', providerId: 'qwen' },
  { host: 'api.baichuan-ai.com', providerId: 'baichuan' },
  { host: 'api.lingyiwanwu.com', providerId: 'lingyiwanwu' },
  { host: 'open.bigmodel.cn', providerId: 'zhipu-glm' },
  { host: 'api.minimax.chat', providerId: 'minimax' },
  { host: 'api.stability.ai', providerId: 'stability' },
  { host: 'api.deepgram.com', providerId: 'deepgram' },
  { host: 'api.assemblyai.com', providerId: 'assemblyai' },
  { host: 'api.elevenlabs.io', providerId: 'elevenlabs' },
  { host: 'api.anthropic.com', providerId: 'anthropic' },
  { host: 'api.openai.com', providerId: 'openai' },
  { host: 'generativelanguage.googleapis.com', providerId: 'google-gemini' },
];

/**
 * Resolve a legacy `IProvider` to a registry `ProviderId`. Returns `null` for
 * a platform we cannot honestly translate — the caller skips the row rather
 * than fabricating a wrong association.
 */
function mapPlatformToProvider(provider: IProvider): ProviderId | null {
  const direct = DIRECT_PLATFORM_MAP[provider.platform];
  if (direct) return direct;

  // `openai-compatible` / `custom` / `new-api` — fingerprint by baseUrl.
  if (provider.platform === 'openai-compatible' || provider.platform === 'custom' || provider.platform === 'new-api') {
    const baseUrl = (provider.baseUrl ?? '').toLowerCase();
    if (baseUrl) {
      for (const { host, providerId } of BASEURL_FINGERPRINTS) {
        if (baseUrl.includes(host)) return providerId;
      }
    }
    // Fallback: a real user-defined OpenAI-compatible endpoint — preserved as
    // such in the new registry so the user's custom baseUrl survives migration.
    return 'openai-compatible';
  }

  return null;
}

// ─── Bridge tag detection ─────────────────────────────────────────────────────

/**
 * True when a `model.config` row was written by the now-deleted Wave 3A bridge
 * (`legacyModelConfigBridge`). Tagged rows mirror a registry row that already
 * exists; migrating them would create a duplicate. Detected via the same tag
 * the bridge stamped.
 */
function isBridgeTagged(provider: IProvider): boolean {
  return (provider as unknown as Record<string, unknown>)[BRIDGE_TAG_KEY] === BRIDGE_TAG_VALUE;
}

// ─── Cloud creds ──────────────────────────────────────────────────────────────

/**
 * Required field names per cloud provider. A legacy row missing any of these
 * cannot be honestly translated into a `RegistryProvider` — chat-start would
 * crash on the half-built creds. Such rows are skipped with a warning.
 *
 * Mirrors `CLOUD_REQUIRED_FIELDS` in `modelRegistryIpc.ts`.
 */
const CLOUD_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  'aws-bedrock': ['accessKeyId', 'secretAccessKey', 'region'],
  vertex: ['projectId', 'region', 'serviceAccountJson'],
  azure: ['endpoint', 'apiKey'],
};

const CLOUD_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>(['aws-bedrock', 'vertex', 'azure']);

/**
 * Translate a legacy `IProvider`'s cloud-specific block (`bedrockConfig`, no
 * legacy `vertexConfig` or `azureConfig` — Vertex and Azure had no first-class
 * legacy support) into the registry's `{ fields }` shape. Returns `null` when
 * required fields are missing.
 */
function extractCloudFields(providerId: ProviderId, provider: IProvider): Record<string, string> | null {
  const required = CLOUD_REQUIRED_FIELDS[providerId];
  if (!required) return null;

  const fields: Record<string, string> = {};

  if (providerId === 'aws-bedrock') {
    const bc = provider.bedrockConfig;
    if (!bc) return null;
    // The legacy `bedrockConfig` discriminates 'accessKey' vs 'profile' auth.
    // Only accessKey-auth carries usable creds for the registry — profile-auth
    // relies on the host's AWS profile, which the registry's CLOUD_REQUIRED_FIELDS
    // (accessKeyId/secretAccessKey/region) cannot represent. A profile-auth row
    // is honestly incomplete from the registry's perspective; skip it.
    if (bc.authMethod !== 'accessKey') return null;
    if (!bc.accessKeyId || !bc.secretAccessKey || !bc.region) return null;
    fields.accessKeyId = bc.accessKeyId;
    fields.secretAccessKey = bc.secretAccessKey;
    fields.region = bc.region;
  } else if (providerId === 'vertex') {
    // No legacy `vertexConfig` block existed; vertex rows that ever showed up
    // historically did so without usable creds. Skip them.
    return null;
  } else if (providerId === 'azure') {
    // Same — no legacy `azureConfig` block ever existed. The plan's reference
    // to `azureConfig`/`vertexConfig` describes shapes the migration accepts
    // IF an upstream patch ever added them; absent that, azure/vertex legacy
    // rows are skipped.
    return null;
  }

  // Validate every required field is now present + non-empty.
  for (const name of required) {
    const value = fields[name];
    if (typeof value !== 'string' || value.trim().length === 0) return null;
  }
  return fields;
}

// ─── Catalog assembly (unenriched) ────────────────────────────────────────────

/**
 * Derive a `family` from a model id when models.dev isn't consulted. Strips
 * trailing date/build stamps (a pure-numeric token ≥ 4 digits) and trailing
 * variant words. Mirrors the same strategy `CatalogAssembler.deriveFamily` uses.
 */
function deriveFamily(modelId: string): string {
  let id = modelId.replace(/^(anthropic\.|meta\.|models\/)/, '');
  const slash = id.lastIndexOf('/');
  if (slash !== -1) id = id.slice(slash + 1);

  const tokens = id.split('-');
  const VARIANT_WORDS = new Set(['preview', 'exp', 'experimental', 'latest', 'thinking', 'beta', 'alpha', 'rc']);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1].toLowerCase();
    if (/^\d{4,}$/.test(last) || VARIANT_WORDS.has(last)) {
      tokens.pop();
      continue;
    }
    break;
  }
  const family = tokens.join('-');
  return family.length > 0 ? family : id;
}

/**
 * Humanize an unenriched model id into a display name. Mirrors the same casing
 * rule `ModelDisplayNames.humanise` applies: dashes become spaces, words are
 * title-cased, single-letter or numeric tokens are left as-is.
 *
 * Deliberately a duplicate of the assembler's logic rather than a shared import
 * — the migration is a translation-only stage and intentionally has zero I/O
 * (no models.dev fetch), so it does not need the assembler's full apparatus.
 */
function humanizeId(modelId: string): string {
  return modelId
    .split(/[-_]/)
    .map((token) => {
      if (token.length === 0) return token;
      // Keep version tokens (4o, gpt, 4.1) as-is — uppercase known acronyms.
      if (/^[A-Z]{2,}$/.test(token)) return token;
      if (/\d/.test(token)) return token;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
}

/**
 * Build an unenriched `CatalogModel` from a legacy model id. The migration
 * deliberately does NOT fetch models.dev — the user's next `refresh` from the
 * Manage page will enrich every model from the live registry. Until then the
 * model is honest about being unenriched (`enriched: false`).
 */
function buildUnenrichedCatalogModel(modelId: string, providerId: ProviderId): CatalogModel {
  return {
    id: modelId,
    providerId,
    displayName: humanizeId(modelId),
    family: deriveFamily(modelId),
    kind: 'text',
    enriched: false,
  };
}

// ─── Migration entry point ────────────────────────────────────────────────────

/**
 * Run the one-time migration. Idempotent via `MIGRATION_FLAG_KEY` in the config
 * store: a successful run sets the flag; subsequent boots short-circuit.
 *
 * Never throws. Per-row failures are caught and logged so one bad row cannot
 * stop the rest. A catastrophic error reading the config or flag falls back to
 * "skip the migration" so the rest of the app keeps booting.
 */
export async function runLegacyModelConfigMigration(args: {
  store: LegacyConfigStore;
  repo: MigrationRepo;
  logger?: (level: 'info' | 'warn', message: string) => void;
}): Promise<MigrationResult> {
  const { store, repo, logger } = args;
  const log = logger ?? defaultLogger;

  const empty: MigrationResult = {
    ran: false,
    migrated: 0,
    skippedBridge: 0,
    skippedExisting: 0,
    skippedUnsupported: 0,
    skippedIncompleteCloud: 0,
  };

  // ── Idempotency gate ────────────────────────────────────────────────────────
  let flagAlreadySet = false;
  try {
    flagAlreadySet = (await store.get(MIGRATION_FLAG_KEY)) === true;
  } catch (error) {
    log('warn', `[legacyModelConfigMigration] Failed to read migration flag: ${describe(error)}`);
    return empty;
  }
  if (flagAlreadySet) return empty;

  // ── Read source ────────────────────────────────────────────────────────────
  let legacyRows: IProvider[] = [];
  try {
    const raw = await store.get('model.config');
    legacyRows = Array.isArray(raw) ? (raw as IProvider[]) : [];
  } catch (error) {
    log('warn', `[legacyModelConfigMigration] Failed to read model.config: ${describe(error)}`);
    // Mark the migration as run anyway — a missing/unreadable legacy store
    // means there is nothing to migrate, and we want the next boot to skip.
    await safeSetFlag(store, log);
    return { ...empty, ran: true };
  }

  // ── Per-row translation ────────────────────────────────────────────────────
  const result: MigrationResult = { ...empty, ran: true };

  for (const row of legacyRows) {
    try {
      // 1) Bridge mirrors are already in the registry — skip them.
      if (isBridgeTagged(row)) {
        result.skippedBridge++;
        continue;
      }

      // 2) Map platform → ProviderId. Unmappable → skip with a warning.
      const providerId = mapPlatformToProvider(row);
      if (!providerId) {
        log('warn', `[legacyModelConfigMigration] Skipping unsupported platform '${row.platform}'`);
        result.skippedUnsupported++;
        continue;
      }

      // 3) Already in the registry — the user has connected this provider
      //    through the new Models page. The new connection wins; skip the
      //    legacy import to avoid clobbering it.
      if (repo.getRegistryProvider(providerId)) {
        result.skippedExisting++;
        continue;
      }

      // 4) Build creds. Cloud → fields; everything else → key (+ optional baseUrl).
      const isCloud = CLOUD_PROVIDER_IDS.has(providerId);
      let creds: Record<string, unknown>;

      if (isCloud) {
        const fields = extractCloudFields(providerId, row);
        if (!fields) {
          log('warn', `[legacyModelConfigMigration] Skipping cloud provider '${providerId}' — required fields missing`);
          result.skippedIncompleteCloud++;
          continue;
        }
        creds = { fields };
      } else {
        if (!row.apiKey || row.apiKey.trim().length === 0) {
          log('warn', `[legacyModelConfigMigration] Skipping '${providerId}' — empty apiKey`);
          result.skippedUnsupported++;
          continue;
        }
        creds = { key: row.apiKey };
        // Preserve a user-set custom base URL so the next refresh's
        // `ApiProviderSource` keeps targeting the user's endpoint.
        if (row.baseUrl && row.baseUrl.trim().length > 0) {
          creds.baseUrl = row.baseUrl;
        }
      }

      // 5) Persist the provider row + an unenriched catalog of every model
      //    the legacy row listed. The next manual or scheduled `refresh` will
      //    enrich them from models.dev.
      repo.upsertRegistryProvider({
        providerId,
        connectedVia: isCloud ? 'cloud-credentials' : 'api-key',
        state: 'connected',
        creds,
      });

      const modelIds = Array.isArray(row.model) ? row.model.filter((m) => typeof m === 'string' && m.length > 0) : [];
      const catalog = modelIds.map((id) => buildUnenrichedCatalogModel(id, providerId));
      repo.replaceRegistryCatalog(providerId, catalog);

      result.migrated++;
    } catch (error) {
      log('warn', `[legacyModelConfigMigration] Failed to migrate row '${row?.platform}': ${describe(error)}`);
    }
  }

  await safeSetFlag(store, log);
  log(
    'info',
    `[legacyModelConfigMigration] Done — migrated:${result.migrated} bridge:${result.skippedBridge} existing:${result.skippedExisting} unsupported:${result.skippedUnsupported} incompleteCloud:${result.skippedIncompleteCloud}`
  );

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeSetFlag(store: LegacyConfigStore, log: (level: 'info' | 'warn', m: string) => void): Promise<void> {
  try {
    await store.set(MIGRATION_FLAG_KEY, true);
  } catch (error) {
    log('warn', `[legacyModelConfigMigration] Failed to set migration flag: ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultLogger(level: 'info' | 'warn', message: string): void {
  if (level === 'warn') console.warn(message);
  else console.log(message);
}
