// src/process/services/database/migration_v49.bun.test.ts
// Run with: bun test src/process/services/database/migration_v49.bun.test.ts
//
// Bun-runtime test for migration_v49 (add budgets table for spend caps).
// Verifies the table is created, has NO foreign keys (so PRAGMA
// foreign_key_check stays clean), the scope index exists, up() is idempotent,
// down() drops it, and a row inserts/reads back. Uses BunSqliteDriver so it
// runs where better-sqlite3 ABI-mismatches under Bun.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BunSqliteDriver } from './drivers/BunSqliteDriver';
import { ALL_MIGRATIONS, type IMigration } from './migrations';

const migration_v49 = ALL_MIGRATIONS.find((m) => m.version === 49) as IMigration | undefined;

function tableExists(driver: BunSqliteDriver, name: string): boolean {
  try {
    driver.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

describe('Migration v49 - budgets table (bun:sqlite)', () => {
  let driver: BunSqliteDriver;

  beforeEach(() => {
    driver = new BunSqliteDriver(':memory:');
    expect(migration_v49).toBeDefined();
  });

  afterEach(() => driver.close());

  it('is registered in ALL_MIGRATIONS at version 49', () => {
    expect(migration_v49!.version).toBe(49);
    expect(migration_v49!.name).toMatch(/budgets/i);
  });

  it('creates the budgets table', () => {
    migration_v49!.up(driver);
    expect(tableExists(driver, 'budgets')).toBe(true);
  });

  it('declares NO foreign keys (foreign_key_check stays clean)', () => {
    migration_v49!.up(driver);
    const fks = driver.pragma('foreign_key_list(budgets)') as unknown[];
    expect(fks.length).toBe(0);
    const violations = driver.pragma('foreign_key_check') as unknown[];
    expect(violations.length).toBe(0);
  });

  it('creates the scope index', () => {
    migration_v49!.up(driver);
    const indexes = (driver.pragma('index_list(budgets)') as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toContain('idx_budgets_scope');
  });

  it('stores and reads back a budget row', () => {
    migration_v49!.up(driver);
    driver
      .prepare(
        `INSERT INTO budgets (id, scope, scope_key, limit_usd, period, action, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('b1', 'model', 'opus-4', 25.0, 'month', 'warn', 1_700_000_000, 1_700_000_000);

    const row = driver
      .prepare('SELECT scope, scope_key, limit_usd, period, action FROM budgets WHERE id = ?')
      .get('b1') as { scope: string; scope_key: string; limit_usd: number; period: string; action: string };
    expect(row.scope).toBe('model');
    expect(row.scope_key).toBe('opus-4');
    expect(row.limit_usd).toBeCloseTo(25.0, 6);
    expect(row.period).toBe('month');
    expect(row.action).toBe('warn');
  });

  it('allows NULL scope_key (global budget, no FKs)', () => {
    migration_v49!.up(driver);
    expect(() => {
      driver
        .prepare(
          `INSERT INTO budgets (id, scope, limit_usd, period, action, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('b2', 'global', 100, 'week', 'pause', 1, 1);
    }).not.toThrow();
  });

  it('up() is idempotent (re-run does not throw or drop existing rows)', () => {
    migration_v49!.up(driver);
    driver
      .prepare(
        `INSERT INTO budgets (id, scope, limit_usd, period, action, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('b3', 'global', 10, 'day', 'warn', 1, 1);

    expect(() => migration_v49!.up(driver)).not.toThrow();
    const row = driver.prepare('SELECT 1 FROM budgets WHERE id = ?').get('b3');
    expect(row).toBeDefined();
  });

  it('down() drops the table', () => {
    migration_v49!.up(driver);
    expect(tableExists(driver, 'budgets')).toBe(true);
    migration_v49!.down(driver);
    expect(tableExists(driver, 'budgets')).toBe(false);
  });
});
