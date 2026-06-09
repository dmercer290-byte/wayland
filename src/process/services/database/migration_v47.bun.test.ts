// src/process/services/database/migration_v47.bun.test.ts
// Run with: bun test src/process/services/database/migration_v47.bun.test.ts
//
// Bun-runtime test for migration_v47 (add channel_welcome table for the
// once-per-account "Hey, it's Wayland" welcome marker). Verifies the table is
// created with the composite primary key, up() is idempotent, down() drops it,
// and the (platform, account_id) marker inserts and reads back cleanly. Uses
// BunSqliteDriver so it runs on dev machines where better-sqlite3 native
// bindings ABI-mismatch under Bun.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BunSqliteDriver } from './drivers/BunSqliteDriver';
import { ALL_MIGRATIONS, type IMigration } from './migrations';

const migration_v47 = ALL_MIGRATIONS.find((m) => m.version === 47) as IMigration | undefined;

function tableExists(driver: BunSqliteDriver, name: string): boolean {
  // Probe by selecting from the table directly rather than via a cached
  // sqlite_master query: bun:sqlite caches compiled statements by SQL text, so
  // a parameterised sqlite_master lookup can return a stale row after a DROP.
  try {
    driver.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

describe('Migration v47 - channel_welcome table (bun:sqlite)', () => {
  let driver: BunSqliteDriver;

  beforeEach(() => {
    driver = new BunSqliteDriver(':memory:');
    expect(migration_v47).toBeDefined();
  });

  afterEach(() => driver.close());

  it('is registered in ALL_MIGRATIONS at version 47', () => {
    expect(migration_v47!.version).toBe(47);
    expect(migration_v47!.name).toMatch(/channel_welcome/i);
  });

  it('creates the channel_welcome table', () => {
    migration_v47!.up(driver);
    expect(tableExists(driver, 'channel_welcome')).toBe(true);
  });

  it('stores and reads back a (platform, account_id) marker', () => {
    migration_v47!.up(driver);
    driver
      .prepare('INSERT INTO channel_welcome (platform, account_id, welcomed_at) VALUES (?, ?, ?)')
      .run('whatsapp', '15551234567@s.whatsapp.net', 1_700_000_000);

    const row = driver
      .prepare('SELECT account_id, welcomed_at FROM channel_welcome WHERE platform = ?')
      .get('whatsapp') as { account_id: string; welcomed_at: number };
    expect(row.account_id).toBe('15551234567@s.whatsapp.net');
    expect(row.welcomed_at).toBe(1_700_000_000);
  });

  it('keys uniquely on platform + account_id (composite PK rejects duplicates)', () => {
    migration_v47!.up(driver);
    const insert = (): void => {
      driver
        .prepare('INSERT INTO channel_welcome (platform, account_id, welcomed_at) VALUES (?, ?, ?)')
        .run('telegram', 'bot-1', 1);
    };
    insert();
    expect(() => insert()).toThrow();

    // Same account id on a different platform is a distinct marker.
    expect(() => {
      driver
        .prepare('INSERT INTO channel_welcome (platform, account_id, welcomed_at) VALUES (?, ?, ?)')
        .run('discord', 'bot-1', 1);
    }).not.toThrow();
  });

  it('up() is idempotent (re-run does not throw or drop existing rows)', () => {
    migration_v47!.up(driver);
    driver
      .prepare('INSERT INTO channel_welcome (platform, account_id, welcomed_at) VALUES (?, ?, ?)')
      .run('email-imap', 'me@example.com', 1);

    expect(() => migration_v47!.up(driver)).not.toThrow();

    const row = driver
      .prepare('SELECT 1 FROM channel_welcome WHERE platform = ? AND account_id = ?')
      .get('email-imap', 'me@example.com');
    expect(row).toBeDefined();
  });

  it('down() drops the table', () => {
    migration_v47!.up(driver);
    expect(tableExists(driver, 'channel_welcome')).toBe(true);
    migration_v47!.down(driver);
    expect(tableExists(driver, 'channel_welcome')).toBe(false);
  });
});
