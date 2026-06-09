/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver, IStatement } from '@process/services/database/drivers/ISqliteDriver';
import type { Budget, BudgetAction, BudgetPeriod, BudgetScope, IBudgetRepository } from './types';

type BudgetRow = {
  id: string;
  scope: string;
  scope_key: string | null;
  limit_usd: number;
  period: string;
  action: string;
  created_at: number;
  updated_at: number;
};

function rowToBudget(r: BudgetRow): Budget {
  return {
    id: r.id,
    scope: r.scope as BudgetScope,
    scopeKey: r.scope_key ?? undefined,
    limitUsd: r.limit_usd,
    period: r.period as BudgetPeriod,
    action: r.action as BudgetAction,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * SQLite implementation of IBudgetRepository over the budgets table
 * (migration_v49). All methods are synchronous (better-sqlite3 / bun:sqlite);
 * the caller obtains the driver via `getDatabase().getDriver()`. Mirrors
 * SqliteCostRepository: prepared statements, positional `?` binds.
 */
export class SqliteBudgetRepository implements IBudgetRepository {
  private readonly stmtUpsert: IStatement;
  private readonly stmtDelete: IStatement;
  private readonly stmtList: IStatement;
  private readonly stmtGetById: IStatement;

  constructor(private readonly db: ISqliteDriver) {
    this.stmtUpsert = db.prepare(`
      INSERT INTO budgets (id, scope, scope_key, limit_usd, period, action, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope = excluded.scope,
        scope_key = excluded.scope_key,
        limit_usd = excluded.limit_usd,
        period = excluded.period,
        action = excluded.action,
        updated_at = excluded.updated_at
    `);
    this.stmtDelete = db.prepare('DELETE FROM budgets WHERE id = ?');
    this.stmtList = db.prepare('SELECT * FROM budgets ORDER BY created_at DESC, id ASC');
    this.stmtGetById = db.prepare('SELECT * FROM budgets WHERE id = ?');
  }

  upsert(budget: Budget): void {
    this.stmtUpsert.run(
      budget.id,
      budget.scope,
      budget.scopeKey ?? null,
      budget.limitUsd,
      budget.period,
      budget.action,
      budget.createdAt,
      budget.updatedAt
    );
  }

  delete(id: string): number {
    return this.stmtDelete.run(id).changes;
  }

  list(): Budget[] {
    return (this.stmtList.all() as BudgetRow[]).map(rowToBudget);
  }

  getById(id: string): Budget | undefined {
    const row = this.stmtGetById.get(id) as BudgetRow | undefined;
    return row ? rowToBudget(row) : undefined;
  }
}
