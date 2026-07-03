/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * UsageCalendar - calendar-style heatmap of token usage with hour / day /
 * week / month granularity and a per-model filter.
 *
 * Chart-design notes (dataviz method): the cell encodes ONE magnitude
 * (tokens), so color is a sequential single-hue ramp - five opacity steps of
 * the app's primary hue over the surface, monotonic light→dark in both
 * themes. Model identity is carried by the FILTER (and the tooltip's
 * per-model breakdown), never by cell hue. Every cell has a hover tooltip;
 * a "less → more" ramp key stands in for a legend on this single-measure
 * form; text stays in text tokens.
 *
 * Data: day-bucketed per-model series for Day/Week/Month (aggregated
 * client-side so Month uses true calendar months), hour buckets for Hour.
 */

import { Radio, Select, Spin, Tooltip, Typography } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { CostModelSeriesPoint } from '@process/services/cost/types';

type Granularity = 'hour' | 'day' | 'week' | 'month';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const ALL_MODELS = '__all__';
/** Sequential ramp: five opacity steps of the primary hue (light → dark). */
const RAMP_STEPS = [0.15, 0.32, 0.5, 0.72, 0.95];

type Cell = {
  startMs: number;
  label: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  byModel: Array<{ modelId: string; tokens: number; inputTokens: number; outputTokens: number }>;
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

/** Start of the local day containing `ms`. */
const dayStart = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const UsageCalendar: React.FC = () => {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [modelFilter, setModelFilter] = useState<string>(ALL_MODELS);
  const [points, setPoints] = useState<CostModelSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const now = Date.now();
      // Hour view: 7 days of hour buckets. Everything else: 366 days of day
      // buckets, aggregated client-side (months need true calendar months).
      const window =
        granularity === 'hour'
          ? { fromMs: dayStart(now) - 6 * DAY_MS, toMs: now }
          : { fromMs: dayStart(now) - 365 * DAY_MS, toMs: now };
      const bucketMs = granularity === 'hour' ? HOUR_MS : DAY_MS;
      const rows = await ipcBridge.cost.seriesByModel.invoke({ window, bucketMs });
      setPoints(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('[UsageCalendar] load failed:', err);
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [granularity]);

  useEffect(() => {
    void load();
  }, [load]);

  const modelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of points) if (p.modelId) ids.add(p.modelId);
    return [...ids].sort();
  }, [points]);

  const unattributed = t('missionControl.cost.calendar.unattributed', { defaultValue: '(unattributed)' });

  /** Aggregate raw points into cells for the active granularity + filter. */
  const cells = useMemo((): Cell[] => {
    const filtered = modelFilter === ALL_MODELS ? points : points.filter((p) => p.modelId === modelFilter);
    const byBucket = new Map<number, Cell>();

    const bucketOf = (ms: number): { start: number; label: string } => {
      const d = new Date(ms);
      switch (granularity) {
        case 'hour':
          return { start: ms, label: d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' }) };
        case 'day':
          return { start: dayStart(ms), label: d.toLocaleDateString() };
        case 'week': {
          const start = dayStart(ms) - ((d.getDay() + 6) % 7) * DAY_MS; // Monday
          return { start, label: `${new Date(start).toLocaleDateString()} +7d` };
        }
        case 'month': {
          const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
          return { start, label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) };
        }
      }
    };

    for (const p of filtered) {
      const { start, label } = bucketOf(p.bucketStart);
      let cell = byBucket.get(start);
      if (!cell) {
        cell = {
          startMs: start,
          label,
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0,
          byModel: [],
        };
        byBucket.set(start, cell);
      }
      cell.tokens += p.tokensTotal;
      cell.inputTokens += p.inputTokens;
      cell.outputTokens += p.outputTokens;
      cell.cacheReadTokens += p.cacheReadTokens;
      cell.costUsd += p.costUsd;
      const entry = cell.byModel.find((m) => m.modelId === p.modelId);
      if (entry) {
        entry.tokens += p.tokensTotal;
        entry.inputTokens += p.inputTokens;
        entry.outputTokens += p.outputTokens;
      } else {
        cell.byModel.push({
          modelId: p.modelId,
          tokens: p.tokensTotal,
          inputTokens: p.inputTokens,
          outputTokens: p.outputTokens,
        });
      }
    }

    // Fill empty buckets so the calendar shape is continuous.
    const out: Cell[] = [];
    const now = Date.now();
    const pushRange = (start: number, step: (ms: number) => number, count: number): void => {
      let cursor = start;
      for (let i = 0; i < count && cursor <= now; i++) {
        const existing = byBucket.get(cursor);
        out.push(
          existing ?? {
            startMs: cursor,
            label: bucketOf(cursor).label,
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            costUsd: 0,
            byModel: [],
          }
        );
        cursor = step(cursor);
      }
    };
    if (granularity === 'hour') {
      pushRange(dayStart(now) - 6 * DAY_MS, (ms) => ms + HOUR_MS, 7 * 24);
    } else if (granularity === 'day') {
      pushRange(dayStart(now) - 83 * DAY_MS, (ms) => ms + DAY_MS, 84); // 12 weeks
    } else if (granularity === 'week') {
      const monday = dayStart(now) - ((new Date(now).getDay() + 6) % 7) * DAY_MS;
      pushRange(monday - 25 * 7 * DAY_MS, (ms) => ms + 7 * DAY_MS, 26);
    } else {
      const d = new Date(now);
      const first = new Date(d.getFullYear(), d.getMonth() - 11, 1).getTime();
      pushRange(
        first,
        (ms) => {
          const m = new Date(ms);
          return new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
        },
        12
      );
    }
    return out;
  }, [points, modelFilter, granularity]);

  const maxTokens = useMemo(() => cells.reduce((m, c) => Math.max(m, c.tokens), 0), [cells]);

  const cellColor = (tokens: number): string => {
    if (tokens <= 0 || maxTokens <= 0) return 'rgb(var(--fill-2))';
    const step = Math.min(RAMP_STEPS.length - 1, Math.floor((tokens / maxTokens) * RAMP_STEPS.length));
    return `rgba(var(--primary-6), ${RAMP_STEPS[step]})`;
  };

  const tooltipFor = (cell: Cell): React.ReactNode => (
    <div className='flex flex-col gap-2px text-12px'>
      <span>{cell.label}</span>
      <span>
        {t('missionControl.cost.calendar.cellTokens', {
          defaultValue: '{{tokens}} tokens · {{cost}}',
          tokens: formatTokens(cell.tokens),
          cost: cell.costUsd >= 0.01 ? `$${cell.costUsd.toFixed(2)}` : `$${cell.costUsd.toFixed(4)}`,
        })}
      </span>
      {(cell.inputTokens > 0 || cell.outputTokens > 0) && (
        <span>
          {t('missionControl.cost.calendar.cellSplit', {
            defaultValue: 'in {{input}} · out {{output}}{{cache}}',
            input: formatTokens(cell.inputTokens),
            output: formatTokens(cell.outputTokens),
            cache: cell.cacheReadTokens > 0 ? ` · cache ${formatTokens(cell.cacheReadTokens)}` : '',
          })}
        </span>
      )}
      {modelFilter === ALL_MODELS &&
        cell.byModel
          .toSorted((a, b) => b.tokens - a.tokens)
          .slice(0, 5)
          .map((m) => (
            <span key={m.modelId}>
              {m.modelId || unattributed}: {formatTokens(m.tokens)}
              {(m.inputTokens > 0 || m.outputTokens > 0) &&
                ` (${formatTokens(m.inputTokens)}↓ ${formatTokens(m.outputTokens)}↑)`}
            </span>
          ))}
    </div>
  );

  // Grid shape per granularity: hour = 24 rows × 7 cols; day = 7 rows × 12
  // cols (GitHub-style); week/month = single wrapped row.
  const columns = granularity === 'hour' ? 7 : granularity === 'day' ? 12 : granularity === 'week' ? 26 : 12;
  const vertical = granularity === 'hour' || granularity === 'day';

  return (
    <div className='flex flex-col gap-12px' data-testid='usage-calendar'>
      <div className='flex items-center justify-between gap-12px flex-wrap'>
        <Typography.Text className='text-14px font-medium'>
          {t('missionControl.cost.calendar.title', { defaultValue: 'Token usage calendar' })}
        </Typography.Text>
        <div className='flex items-center gap-8px'>
          <Select
            value={modelFilter}
            onChange={(value: string) => {
              setModelFilter(value);
            }}
            style={{ width: 220 }}
            size='small'
            showSearch
            data-testid='usage-calendar-model-filter'
          >
            <Select.Option value={ALL_MODELS}>
              {t('missionControl.cost.calendar.allModels', { defaultValue: 'All models' })}
            </Select.Option>
            {modelIds.map((id) => (
              <Select.Option key={id} value={id}>
                {id || unattributed}
              </Select.Option>
            ))}
          </Select>
          <Radio.Group
            type='button'
            size='small'
            value={granularity}
            onChange={(value: Granularity) => {
              setGranularity(value);
            }}
            data-testid='usage-calendar-granularity'
          >
            <Radio value='hour'>{t('missionControl.cost.calendar.hour', { defaultValue: 'Hour' })}</Radio>
            <Radio value='day'>{t('missionControl.cost.calendar.day', { defaultValue: 'Day' })}</Radio>
            <Radio value='week'>{t('missionControl.cost.calendar.week', { defaultValue: 'Week' })}</Radio>
            <Radio value='month'>{t('missionControl.cost.calendar.month', { defaultValue: 'Month' })}</Radio>
          </Radio.Group>
        </div>
      </div>

      {loading ? (
        <div className='flex justify-center p-16px'>
          <Spin />
        </div>
      ) : (
        <>
          <div
            className='grid gap-2px w-full overflow-x-auto'
            style={
              vertical
                ? {
                    gridTemplateColumns: `repeat(${columns}, minmax(10px, 1fr))`,
                    gridAutoFlow: 'column',
                    gridTemplateRows: `repeat(${granularity === 'hour' ? 24 : 7}, 12px)`,
                  }
                : { gridTemplateColumns: `repeat(${columns}, minmax(10px, 1fr))` }
            }
            role='img'
            aria-label={t('missionControl.cost.calendar.title', { defaultValue: 'Token usage calendar' })}
          >
            {cells.map((cell) => (
              <Tooltip key={cell.startMs} content={tooltipFor(cell)}>
                <div
                  className='rd-2px min-h-12px cursor-default'
                  style={{ backgroundColor: cellColor(cell.tokens) }}
                  data-testid='usage-calendar-cell'
                />
              </Tooltip>
            ))}
          </div>
          <div className='flex items-center gap-4px self-end'>
            <span className='text-11px text-t-tertiary'>
              {t('missionControl.cost.calendar.less', { defaultValue: 'Less' })}
            </span>
            <div className='w-10px h-10px rd-2px' style={{ backgroundColor: 'rgb(var(--fill-2))' }} />
            {RAMP_STEPS.map((alpha) => (
              <div
                key={alpha}
                className='w-10px h-10px rd-2px'
                style={{ backgroundColor: `rgba(var(--primary-6), ${alpha})` }}
              />
            ))}
            <span className='text-11px text-t-tertiary'>
              {t('missionControl.cost.calendar.more', { defaultValue: 'More' })}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default UsageCalendar;
