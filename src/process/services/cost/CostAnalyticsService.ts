/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { SqliteCostRepository } from './SqliteCostRepository';
import type { CostAggregate, CostSeriesPoint, CostSummary, CostWindow, ICostRepository } from './types';

/**
 * Thin read-only service over the cost_events table (migration_v48), exposing
 * the analytics queries the renderer (WS-E) consumes. It owns a single
 * SqliteCostRepository built from the shared SQLite driver; all methods are
 * synchronous like the underlying repository.
 *
 * Writes go through CostRecorder (WS-A); this service is reads only.
 */
export class CostAnalyticsService {
  private readonly repo: ICostRepository;

  constructor(driver: ISqliteDriver) {
    this.repo = new SqliteCostRepository(driver);
  }

  /** Total cost + tokens + row count within a window. */
  summary(window: CostWindow): CostSummary {
    return this.repo.total(window);
  }

  /** Cost + tokens grouped by model id within a window, ordered by cost desc. */
  byModel(window: CostWindow): CostAggregate[] {
    return this.repo.aggregate('model_id', window);
  }

  /** Cost + tokens grouped by backend within a window, ordered by cost desc. */
  byBackend(window: CostWindow): CostAggregate[] {
    return this.repo.aggregate('backend', window);
  }

  /** Cost + tokens grouped by conversation id within a window, ordered by cost desc. */
  byConversation(window: CostWindow): CostAggregate[] {
    return this.repo.aggregate('conversation_id', window);
  }

  /** Cost + tokens grouped by team id within a window, ordered by cost desc. */
  byTeam(window: CostWindow): CostAggregate[] {
    return this.repo.aggregate('team_id', window);
  }

  /** Fixed-width time-bucketed series over a window. `bucketMs` > 0. */
  series(window: CostWindow, bucketMs: number): CostSeriesPoint[] {
    return this.repo.series(window, bucketMs);
  }
}
