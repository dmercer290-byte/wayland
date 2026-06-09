// src/process/services/cost/SqliteBudgetRepository.bun.test.ts
// Run with: bun test src/process/services/cost/SqliteBudgetRepository.bun.test.ts
//
// Verifies the budget CRUD surface: upsert (insert + in-place update via
// ON CONFLICT), list (newest first), getById, and delete (returns rows
// removed). Uses bun:sqlite with migration_v49 applied.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BunSqliteDriver } from '@process/services/database/drivers/BunSqliteDriver';
import { ALL_MIGRATIONS, type IMigration } from '@process/services/database/migrations';
import { SqliteBudgetRepository } from './SqliteBudgetRepository';
import type { Budget } from './types';

const migration_v49 = ALL_MIGRATIONS.find((m) => m.version === 49) as IMigration;

function budget(overrides: Partial<Budget>): Budget {
  return {
    id: 'b1',
    scope: 'global',
    limitUsd: 10,
    period: 'month',
    action: 'warn',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('SqliteBudgetRepository (bun:sqlite)', () => {
  let driver: BunSqliteDriver;
  let repo: SqliteBudgetRepository;

  beforeEach(() => {
    driver = new BunSqliteDriver(':memory:');
    migration_v49.up(driver);
    repo = new SqliteBudgetRepository(driver);
  });

  afterEach(() => driver.close());

  it('upsert inserts a new row, getById reads it back', () => {
    repo.upsert(budget({ id: 'b1', scope: 'model', scopeKey: 'opus-4', limitUsd: 25 }));
    const read = repo.getById('b1');
    expect(read).toBeDefined();
    expect(read!.scope).toBe('model');
    expect(read!.scopeKey).toBe('opus-4');
    expect(read!.limitUsd).toBeCloseTo(25, 6);
  });

  it('upsert replaces an existing row in place (ON CONFLICT)', () => {
    repo.upsert(budget({ id: 'b1', limitUsd: 10, action: 'warn' }));
    repo.upsert(budget({ id: 'b1', limitUsd: 99, action: 'pause', updatedAt: 2000 }));
    const read = repo.getById('b1');
    expect(read!.limitUsd).toBeCloseTo(99, 6);
    expect(read!.action).toBe('pause');
    expect(read!.updatedAt).toBe(2000);
    expect(repo.list().length).toBe(1);
  });

  it('global scope round-trips a null scopeKey as undefined', () => {
    repo.upsert(budget({ id: 'g', scope: 'global', scopeKey: undefined }));
    expect(repo.getById('g')!.scopeKey).toBeUndefined();
  });

  it('list returns newest first', () => {
    repo.upsert(budget({ id: 'old', createdAt: 100 }));
    repo.upsert(budget({ id: 'new', createdAt: 200 }));
    const ids = repo.list().map((b) => b.id);
    expect(ids).toEqual(['new', 'old']);
  });

  it('delete removes the row and returns the count', () => {
    repo.upsert(budget({ id: 'b1' }));
    expect(repo.delete('b1')).toBe(1);
    expect(repo.getById('b1')).toBeUndefined();
    expect(repo.delete('missing')).toBe(0);
  });
});
