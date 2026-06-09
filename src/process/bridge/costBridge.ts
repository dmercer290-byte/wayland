/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { CostAnalyticsService } from '@process/services/cost/CostAnalyticsService';
import type { BudgetController } from '@process/services/cost/BudgetController';
import type {
  Budget,
  BudgetInput,
  BudgetStatus,
  CostAggregate,
  CostSeriesPoint,
  CostSummary,
  CostWindow,
} from '@process/services/cost/types';

const EMPTY_SUMMARY: CostSummary = { costUsd: 0, tokensTotal: 0, events: 0 };

/**
 * Cost observability bridge - exposes the read-only cost_events analytics to
 * the renderer (Mission Control cost panel). Mirrors missionControlBridge: a
 * set of one-shot query providers backed by a single main-process service.
 *
 * The service resolves after `getDatabase()` settles. Providers are registered
 * by `initCostBridge` once the live service exists, so there is no cold-start
 * buffering here (unlike usage telemetry, the renderer fetches these lazily on
 * panel open). Each handler swallows errors and returns an empty result so a
 * query failure never breaks the renderer.
 *
 * Remote (paired-device WebSocket) callers are blocked from every cost.* read
 * by the `cost.` prefix in bridgeAllowlist.ts - enforcement is at the WS
 * adapter, not here.
 */
export function initCostBridge(service: CostAnalyticsService): void {
  ipcBridge.cost.summary.provider(async (window: CostWindow): Promise<CostSummary> => {
    try {
      return service.summary(window);
    } catch (error) {
      console.error('[costBridge] summary error:', error);
      return EMPTY_SUMMARY;
    }
  });

  ipcBridge.cost.byModel.provider(async (window: CostWindow): Promise<CostAggregate[]> => {
    try {
      return service.byModel(window);
    } catch (error) {
      console.error('[costBridge] byModel error:', error);
      return [];
    }
  });

  ipcBridge.cost.byBackend.provider(async (window: CostWindow): Promise<CostAggregate[]> => {
    try {
      return service.byBackend(window);
    } catch (error) {
      console.error('[costBridge] byBackend error:', error);
      return [];
    }
  });

  ipcBridge.cost.byConversation.provider(async (window: CostWindow): Promise<CostAggregate[]> => {
    try {
      return service.byConversation(window);
    } catch (error) {
      console.error('[costBridge] byConversation error:', error);
      return [];
    }
  });

  ipcBridge.cost.byTeam.provider(async (window: CostWindow): Promise<CostAggregate[]> => {
    try {
      return service.byTeam(window);
    } catch (error) {
      console.error('[costBridge] byTeam error:', error);
      return [];
    }
  });

  ipcBridge.cost.series.provider(
    async ({ window, bucketMs }: { window: CostWindow; bucketMs: number }): Promise<CostSeriesPoint[]> => {
      try {
        return service.series(window, bucketMs);
      } catch (error) {
        console.error('[costBridge] series error:', error);
        return [];
      }
    }
  );
}

/**
 * Budget mutation + status bridge (Stage 1 / WS-F). Registered separately from
 * the read analytics so it can be wired once the BudgetController exists (it
 * depends on the same SQLite driver + analytics service). upsert/delete are
 * mutations and listBudgets discloses spend; all three are remote-denied by the
 * `cost.` prefix in bridgeAllowlist.ts. The controller emits cost.budgetAlert
 * itself via the emitter passed to its constructor (see initBridge.ts).
 */
export function initCostBudgetBridge(controller: BudgetController): void {
  ipcBridge.cost.upsertBudget.provider(async (input: BudgetInput): Promise<Budget> => {
    return controller.upsert(input);
  });

  ipcBridge.cost.deleteBudget.provider(async (id: string): Promise<void> => {
    controller.remove(id);
  });

  ipcBridge.cost.listBudgets.provider(async (): Promise<BudgetStatus[]> => {
    try {
      return controller.listStatus();
    } catch (error) {
      console.error('[costBridge] listBudgets error:', error);
      return [];
    }
  });
}
