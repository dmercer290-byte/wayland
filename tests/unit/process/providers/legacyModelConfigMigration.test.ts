/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the one-time legacy `model.config` → `model_registry_*` migration
 * (Packet 3B). The migration is driven through fakes for `LegacyConfigStore`
 * and `MigrationRepo` — no `ProcessConfig`, no SQLite, no Electron runtime.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { CatalogModel, ProviderId } from '@process/providers/types';
import {
  MIGRATION_FLAG_KEY,
  runLegacyModelConfigMigration,
  type LegacyConfigStore,
  type MigrationRepo,
} from '@process/providers/migration/legacyModelConfigMigration';

// ─── Fakes ────────────────────────────────────────────────────────────────────

/**
 * In-memory `model.config` + flag store. Two slots: the legacy `model.config`
 * array and the migration flag. Any other key throws — the migration must not
 * touch keys it does not declare.
 */
function makeStore(
  initialRows: IProvider[] = [],
  initialFlag: boolean | undefined = undefined
): LegacyConfigStore & {
  current(): IProvider[];
  flag(): boolean | undefined;
} {
  let rows: IProvider[] = [...initialRows];
  let flag: boolean | undefined = initialFlag;
  return {
    current: () => rows,
    flag: () => flag,
    async get(key) {
      if (key === 'model.config') return rows;
      if (key === MIGRATION_FLAG_KEY) return flag;
      throw new Error(`unexpected key ${String(key)}`);
    },
    async set(key, value) {
      if (key === 'model.config') {
        rows = value as IProvider[];
        return;
      }
      if (key === MIGRATION_FLAG_KEY) {
        flag = value as boolean;
        return;
      }
      throw new Error(`unexpected key ${String(key)}`);
    },
  };
}

/** In-memory `MigrationRepo` mirroring the real `ProviderRepository` slice. */
function makeRepo(): MigrationRepo & {
  providers: Map<ProviderId, Record<string, unknown>>;
  catalogs: Map<ProviderId, CatalogModel[]>;
} {
  const providers = new Map<ProviderId, Record<string, unknown>>();
  const catalogs = new Map<ProviderId, CatalogModel[]>();
  return {
    providers,
    catalogs,
    getRegistryProvider(providerId) {
      return providers.get(providerId) ?? null;
    },
    upsertRegistryProvider(p) {
      providers.set(p.providerId, {
        providerId: p.providerId,
        connectedVia: p.connectedVia,
        state: p.state,
        error: p.error,
        creds: p.creds,
      });
    },
    replaceRegistryCatalog(providerId, models) {
      catalogs.set(providerId, models);
    },
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function legacyRow(over: Partial<IProvider> & { platform: string }): IProvider {
  return {
    id: over.id ?? `legacy-${over.platform}`,
    name: over.name ?? over.platform,
    baseUrl: over.baseUrl ?? '',
    apiKey: over.apiKey ?? '',
    model: over.model ?? [],
    ...over,
  };
}

/** Bridge-tagged row — written by the deleted Wave 3A bridge mirror. */
function bridgeMirroredRow(platform: string, apiKey: string, models: string[]): IProvider {
  return {
    ...legacyRow({ platform, apiKey, model: models }),
    __waylandModelRegistryBridge: 'v1',
  } as IProvider;
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('runLegacyModelConfigMigration — idempotency', () => {
  it('does nothing when the flag is already set', async () => {
    const store = makeStore([legacyRow({ platform: 'openai', apiKey: 'sk-x', model: ['gpt-4o'] })], true);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.ran).toBe(false);
    expect(result.migrated).toBe(0);
    expect(repo.providers.size).toBe(0);
  });

  it('sets the flag on a first successful run, even with zero rows', async () => {
    const store = makeStore();
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.ran).toBe(true);
    expect(result.migrated).toBe(0);
    expect(store.flag()).toBe(true);
  });

  it('a second run is a no-op (only the first run migrates)', async () => {
    const store = makeStore([legacyRow({ platform: 'anthropic', apiKey: 'sk-ant-1', model: ['claude-3-5'] })]);
    const repo = makeRepo();

    await runLegacyModelConfigMigration({ store, repo });
    expect(repo.providers.size).toBe(1);

    // Simulate a user adding a different provider through the new flow after
    // the first run. Drop the registry row from our stub so we can detect any
    // re-migration overwriting it — there must be none.
    repo.providers.clear();
    repo.catalogs.clear();

    const second = await runLegacyModelConfigMigration({ store, repo });
    expect(second.ran).toBe(false);
    expect(repo.providers.size).toBe(0);
  });
});

// ─── Standard providers ───────────────────────────────────────────────────────

describe('runLegacyModelConfigMigration — standard providers', () => {
  it('migrates a clean openai legacy row into the registry', async () => {
    const store = makeStore([legacyRow({ platform: 'openai', apiKey: 'sk-real', model: ['gpt-4o', 'gpt-4o-mini'] })]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.migrated).toBe(1);
    const row = repo.providers.get('openai');
    expect(row).toBeDefined();
    expect(row?.state).toBe('connected');
    expect(row?.connectedVia).toBe('api-key');
    expect(row?.creds).toEqual({ key: 'sk-real' });

    const catalog = repo.catalogs.get('openai');
    expect(catalog?.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(catalog?.[0].enriched).toBe(false);
    expect(catalog?.[0].kind).toBe('text');
    expect(catalog?.[0].providerId).toBe('openai');
  });

  it('preserves a user-set custom baseUrl on api-key providers', async () => {
    // A `custom` legacy platform with a fingerprint that doesn't match a known
    // host falls through to `openai-compatible` and keeps the user's baseUrl.
    const store = makeStore([
      legacyRow({
        platform: 'custom',
        baseUrl: 'https://my-self-hosted.example.com/v1',
        apiKey: 'sk-self',
        model: ['llama3'],
      }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.migrated).toBe(1);
    const row = repo.providers.get('openai-compatible');
    expect(row?.creds).toEqual({ key: 'sk-self', baseUrl: 'https://my-self-hosted.example.com/v1' });
  });

  it('fingerprints openai-compatible baseUrls to a real ProviderId when known', async () => {
    const store = makeStore([
      legacyRow({
        platform: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or',
        model: ['anthropic/claude-3-5-sonnet'],
      }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.migrated).toBe(1);
    expect(repo.providers.has('openrouter')).toBe(true);
    expect(repo.providers.get('openrouter')?.creds).toEqual({
      key: 'sk-or',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('translates the legacy `gemini-with-google-auth` platform to google-gemini', async () => {
    const store = makeStore([
      legacyRow({
        platform: 'gemini-with-google-auth',
        apiKey: 'oauth-stub',
        model: ['gemini-2.0-flash'],
      }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.migrated).toBe(1);
    expect(repo.providers.has('google-gemini')).toBe(true);
  });
});

// ─── Bridge mirrors are skipped ───────────────────────────────────────────────

describe('runLegacyModelConfigMigration — bridge-tagged rows', () => {
  it('skips a row that was written by the Wave 3A bridge mirror', async () => {
    const store = makeStore([bridgeMirroredRow('openai', 'sk-bridge', ['gpt-4o'])]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.skippedBridge).toBe(1);
    expect(result.migrated).toBe(0);
    expect(repo.providers.size).toBe(0);
  });

  it('migrates an untagged row alongside a bridge-tagged one', async () => {
    const store = makeStore([
      bridgeMirroredRow('openai', 'sk-bridge', ['gpt-4o']),
      legacyRow({ platform: 'anthropic', apiKey: 'sk-ant', model: ['claude-3-5'] }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.skippedBridge).toBe(1);
    expect(result.migrated).toBe(1);
    expect(repo.providers.has('anthropic')).toBe(true);
    expect(repo.providers.has('openai')).toBe(false);
  });
});

// ─── Existing registry row wins ───────────────────────────────────────────────

describe('runLegacyModelConfigMigration — existing registry rows', () => {
  it('skips a legacy row whose provider already exists in the registry', async () => {
    const store = makeStore([legacyRow({ platform: 'openai', apiKey: 'sk-legacy', model: ['gpt-4o'] })]);
    const repo = makeRepo();
    // Simulate the user having already connected openai through the new flow.
    repo.upsertRegistryProvider({
      providerId: 'openai',
      connectedVia: 'api-key',
      state: 'connected',
      creds: { key: 'sk-new' },
    });

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.skippedExisting).toBe(1);
    expect(repo.providers.get('openai')?.creds).toEqual({ key: 'sk-new' });
  });
});

// ─── Unsupported / incomplete rows ────────────────────────────────────────────

describe('runLegacyModelConfigMigration — unsupported rows', () => {
  it('skips a row with an unknown platform and logs a warning', async () => {
    const warn = vi.fn();
    const store = makeStore([legacyRow({ platform: 'made-up-platform', apiKey: 'sk-x', model: [] })]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({
      store,
      repo,
      logger: (level, m) => {
        if (level === 'warn') warn(m);
      },
    });

    expect(result.skippedUnsupported).toBe(1);
    expect(result.migrated).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('skips a non-cloud row with an empty apiKey', async () => {
    const store = makeStore([legacyRow({ platform: 'openai', apiKey: '', model: ['gpt-4o'] })]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.skippedUnsupported).toBe(1);
    expect(repo.providers.size).toBe(0);
  });

  it('one bad row does not stop the others', async () => {
    const store = makeStore([
      legacyRow({ platform: 'made-up', apiKey: 'sk', model: [] }),
      legacyRow({ platform: 'openai', apiKey: 'sk-ok', model: ['gpt-4o'] }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.skippedUnsupported).toBe(1);
    expect(result.migrated).toBe(1);
    expect(repo.providers.has('openai')).toBe(true);
  });
});

// ─── Cloud providers ──────────────────────────────────────────────────────────

describe('runLegacyModelConfigMigration — cloud providers', () => {
  it('migrates a bedrock row whose accessKey-auth carries every required field', async () => {
    const store = makeStore([
      legacyRow({
        platform: 'bedrock',
        model: ['anthropic.claude-3-5-sonnet-20241022-v2:0'],
        bedrockConfig: {
          authMethod: 'accessKey',
          region: 'us-east-1',
          accessKeyId: 'AKIA',
          secretAccessKey: 'secret',
        },
      }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.migrated).toBe(1);
    const row = repo.providers.get('aws-bedrock');
    expect(row?.connectedVia).toBe('cloud-credentials');
    expect(row?.creds).toEqual({
      fields: { accessKeyId: 'AKIA', secretAccessKey: 'secret', region: 'us-east-1' },
    });
  });

  it('skips a bedrock row using profile auth (no usable creds for the registry)', async () => {
    const store = makeStore([
      legacyRow({
        platform: 'bedrock',
        model: [],
        bedrockConfig: { authMethod: 'profile', region: 'us-east-1', profile: 'default' },
      }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.skippedIncompleteCloud).toBe(1);
    expect(repo.providers.size).toBe(0);
  });

  it('skips a bedrock row missing a required field', async () => {
    const store = makeStore([
      legacyRow({
        platform: 'bedrock',
        model: [],
        bedrockConfig: {
          authMethod: 'accessKey',
          region: '', // empty region triggers the skip
          accessKeyId: 'AKIA',
          secretAccessKey: 'secret',
        },
      }),
    ]);
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.skippedIncompleteCloud).toBe(1);
    expect(repo.providers.size).toBe(0);
  });
});

// ─── Resilience ───────────────────────────────────────────────────────────────

describe('runLegacyModelConfigMigration — resilience', () => {
  it('handles a missing model.config gracefully (no rows = no crash)', async () => {
    const store: LegacyConfigStore = {
      async get(key) {
        if (key === MIGRATION_FLAG_KEY) return undefined;
        if (key === 'model.config') return undefined;
        throw new Error('unexpected');
      },
      async set() {},
    };
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.ran).toBe(true);
    expect(result.migrated).toBe(0);
  });

  it('still sets the flag when reading model.config throws', async () => {
    let flagSet: unknown = undefined;
    const store: LegacyConfigStore = {
      async get(key) {
        if (key === MIGRATION_FLAG_KEY) return undefined;
        throw new Error('unreadable model.config');
      },
      async set(key, value) {
        if (key === MIGRATION_FLAG_KEY) flagSet = value;
      },
    };
    const repo = makeRepo();

    const result = await runLegacyModelConfigMigration({ store, repo });

    expect(result.ran).toBe(true);
    expect(flagSet).toBe(true);
  });
});
