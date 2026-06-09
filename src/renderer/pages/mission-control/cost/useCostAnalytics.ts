/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Loads the cost observability rollups for the Mission Control cost tab over a
 * day / week / month period. Wraps the read-only `ipcBridge.cost.*` providers
 * (registered in Stage 1, remote-denied by the `cost.` prefix) and recomputes
 * the window whenever the period changes.
 */

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { CostAggregate, CostSeriesPoint, CostSummary } from '@process/services/cost/types';
import { type CostPeriod, PERIOD_BUCKET_MS, periodToWindow } from './costChart';

export type CostAnalytics = {
  period: CostPeriod;
  setPeriod: (p: CostPeriod) => void;
  summary: CostSummary;
  byModel: CostAggregate[];
  byBackend: CostAggregate[];
  byConversation: CostAggregate[];
  byTeam: CostAggregate[];
  series: CostSeriesPoint[];
  loading: boolean;
  refresh: () => Promise<void>;
};

const EMPTY_SUMMARY: CostSummary = { costUsd: 0, tokensTotal: 0, events: 0 };

type Bundle = {
  summary: CostSummary;
  byModel: CostAggregate[];
  byBackend: CostAggregate[];
  byConversation: CostAggregate[];
  byTeam: CostAggregate[];
  series: CostSeriesPoint[];
};

/**
 * One SWR fetch per period bucketed to a stable window key. The window itself
 * is recomputed on each fetch (anchored to `Date.now()`) so a long-lived tab
 * keeps trailing the present without invalidating the SWR cache key on every
 * render.
 */
export function useCostAnalytics(): CostAnalytics {
  const [period, setPeriod] = useState<CostPeriod>('week');

  const { data, isLoading, mutate } = useSWR<Bundle>(
    `cost-analytics/${period}`,
    async (): Promise<Bundle> => {
      const window = periodToWindow(period, Date.now());
      const bucketMs = PERIOD_BUCKET_MS[period];
      const [summary, byModel, byBackend, byConversation, byTeam, series] = await Promise.all([
        ipcBridge.cost.summary.invoke(window),
        ipcBridge.cost.byModel.invoke(window),
        ipcBridge.cost.byBackend.invoke(window),
        ipcBridge.cost.byConversation.invoke(window),
        ipcBridge.cost.byTeam.invoke(window),
        ipcBridge.cost.series.invoke({ window, bucketMs }),
      ]);
      return { summary, byModel, byBackend, byConversation, byTeam, series };
    },
    { revalidateOnFocus: true, refreshInterval: 30_000 }
  );

  const refresh = useCallback(async (): Promise<void> => {
    await mutate();
  }, [mutate]);

  return {
    period,
    setPeriod,
    summary: data?.summary ?? EMPTY_SUMMARY,
    byModel: data?.byModel ?? [],
    byBackend: data?.byBackend ?? [],
    byConversation: data?.byConversation ?? [],
    byTeam: data?.byTeam ?? [],
    series: data?.series ?? [],
    loading: isLoading,
    refresh,
  };
}
