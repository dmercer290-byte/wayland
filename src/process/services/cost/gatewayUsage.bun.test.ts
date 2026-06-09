// src/process/services/cost/gatewayUsage.bun.test.ts
// Run with: bun test src/process/services/cost/gatewayUsage.bun.test.ts
//
// Covers the guarded gateway-usage parser (WS-G) that backs the OpenClaw /
// Remote per-turn token wiring: it reads only concretely-present numeric token
// fields under the known aliases, returns undefined when nothing usable is
// present (the always-absent reality), and rejects malformed values. An
// integration check confirms a parsed split records exactly one tokens-only
// cost_source='unknown' row (gateways surface no model id, so never priced).

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BunSqliteDriver } from '@process/services/database/drivers/BunSqliteDriver';
import { ALL_MIGRATIONS, type IMigration } from '@process/services/database/migrations';
import { SqliteCostRepository } from './SqliteCostRepository';
import { CostRecorder, type ModelPricing } from './CostRecorder';
import { parseGatewayUsage } from './gatewayUsage';

const migration_v48 = ALL_MIGRATIONS.find((m) => m.version === 48) as IMigration;
const noPricing: ModelPricing = { priceTokens: () => undefined };

describe('parseGatewayUsage', () => {
  it('returns undefined when usage is absent or not an object', () => {
    expect(parseGatewayUsage(undefined)).toBeUndefined();
    expect(parseGatewayUsage(null)).toBeUndefined();
    expect(parseGatewayUsage('100 tokens')).toBeUndefined();
    expect(parseGatewayUsage(42)).toBeUndefined();
  });

  it('returns undefined when no recognizable token field is present', () => {
    expect(parseGatewayUsage({})).toBeUndefined();
    expect(parseGatewayUsage({ model: 'x', stopReason: 'end_turn' })).toBeUndefined();
  });

  it('reads snake_case token fields', () => {
    expect(parseGatewayUsage({ input_tokens: 120, output_tokens: 60 })).toEqual({
      inputTokens: 120,
      outputTokens: 60,
      cacheReadTokens: undefined,
      hasTokens: true,
    });
  });

  it('reads camelCase and prompt/completion aliases', () => {
    expect(parseGatewayUsage({ promptTokens: 10, completionTokens: 5 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: undefined,
      hasTokens: true,
    });
  });

  it('captures cache-read tokens when present', () => {
    const parsed = parseGatewayUsage({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20 });
    expect(parsed?.cacheReadTokens).toBe(20);
  });

  it('rejects negative, NaN, and non-numeric token values', () => {
    expect(parseGatewayUsage({ input_tokens: -5 })).toBeUndefined();
    expect(parseGatewayUsage({ input_tokens: Number.NaN })).toBeUndefined();
    expect(parseGatewayUsage({ input_tokens: '120' })).toBeUndefined();
  });

  it('records a partial split when only one side is reported', () => {
    expect(parseGatewayUsage({ output_tokens: 7 })).toEqual({
      inputTokens: undefined,
      outputTokens: 7,
      cacheReadTokens: undefined,
      hasTokens: true,
    });
  });
});

describe('gateway usage -> CostRecorder integration', () => {
  let driver: BunSqliteDriver;

  beforeEach(() => {
    driver = new BunSqliteDriver(':memory:');
    migration_v48.up(driver);
  });

  afterEach(() => driver.close());

  it('records one tokens-only unknown row for a parsed gateway split', () => {
    const recorder = new CostRecorder(new SqliteCostRepository(driver), noPricing);
    const parsed = parseGatewayUsage({ input_tokens: 200, output_tokens: 100 });
    expect(parsed).toBeDefined();

    recorder.recordTurnFinish({
      conversationId: 'conv-remote-1',
      backend: 'remote',
      costSource: 'unknown',
      inputTokens: parsed!.inputTokens,
      outputTokens: parsed!.outputTokens,
      cacheReadTokens: parsed!.cacheReadTokens,
      ts: 1,
    });

    const rows = driver.prepare('SELECT * FROM cost_events').all() as Array<{
      backend: string;
      model_id: string | null;
      cost_usd: number;
      tokens_total: number;
      input_tokens: number | null;
      output_tokens: number | null;
      cost_source: string;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0].backend).toBe('remote');
    expect(rows[0].model_id).toBeNull();
    expect(rows[0].cost_usd).toBe(0);
    expect(rows[0].cost_source).toBe('unknown');
    expect(rows[0].tokens_total).toBe(300);
    expect(rows[0].input_tokens).toBe(200);
    expect(rows[0].output_tokens).toBe(100);
  });
});
