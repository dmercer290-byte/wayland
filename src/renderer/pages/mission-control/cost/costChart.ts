/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure helpers for the cost tab: period -> window resolution, bucket sizing,
 * and the hand-rolled SVG trend geometry. Kept free of React/DOM so the math
 * is unit-testable in the node environment (mirrors the codebase's hand-rolled
 * SVG approach in wiki/components/KnowledgeGraph.tsx - no chart library).
 */

import type { CostSeriesPoint, CostWindow } from '@process/services/cost/types';

/** The three period choices the cost tab offers. */
export type CostPeriod = 'day' | 'week' | 'month';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Length of each period in ms. Drives both the window and the bucket width. */
export const PERIOD_LENGTH_MS: Record<CostPeriod, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};

/**
 * Bucket width per period so the trend chart stays readable:
 *  - day   -> hourly buckets (24 points)
 *  - week  -> daily buckets (7 points)
 *  - month -> daily buckets (30 points)
 */
export const PERIOD_BUCKET_MS: Record<CostPeriod, number> = {
  day: 60 * 60 * 1000,
  week: DAY_MS,
  month: DAY_MS,
};

/**
 * Resolve a period to an inclusive-from / exclusive-to window ending at `now`.
 * The window is exactly one period long.
 */
export function periodToWindow(period: CostPeriod, now: number): CostWindow {
  return { fromMs: now - PERIOD_LENGTH_MS[period], toMs: now };
}

/** Point in the SVG coordinate space for one series bucket. */
export type ChartPoint = { x: number; y: number; point: CostSeriesPoint };

/** Geometry for the hand-rolled trend SVG, computed once per series. */
export type ChartGeometry = {
  width: number;
  height: number;
  /** Inner padding so strokes and labels are not clipped at the edges. */
  pad: { top: number; right: number; bottom: number; left: number };
  points: ChartPoint[];
  /** `points` attribute for the line `polyline`. Empty string when no data. */
  linePoints: string;
  /** `d` attribute for the filled area path. Empty string when no data. */
  areaPath: string;
  /** Peak cost in the series (>= 0). Used for the y-axis max label. */
  maxCostUsd: number;
};

/**
 * Build the SVG geometry for a cost series in a fixed `width` x `height` box.
 * X is spread evenly across buckets; Y maps cost (0..max) to the inner box,
 * inverted so larger cost sits higher. A single-point series renders a flat
 * baseline rather than a divide-by-zero.
 */
export function buildChartGeometry(series: CostSeriesPoint[], width: number, height: number): ChartGeometry {
  const pad = { top: 12, right: 12, bottom: 22, left: 44 };
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);

  const maxCostUsd = series.reduce((m, p) => (p.costUsd > m ? p.costUsd : m), 0);

  if (series.length === 0) {
    return { width, height, pad, points: [], linePoints: '', areaPath: '', maxCostUsd: 0 };
  }

  const denomX = series.length > 1 ? series.length - 1 : 1;
  const points: ChartPoint[] = series.map((point, i) => {
    const x = pad.left + (innerW * i) / denomX;
    const ratio = maxCostUsd > 0 ? point.costUsd / maxCostUsd : 0;
    const y = pad.top + innerH * (1 - ratio);
    return { x, y, point };
  });

  const linePoints = points.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
  const baselineY = pad.top + innerH;
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath =
    `M ${round(first.x)} ${round(baselineY)} ` +
    points.map((p) => `L ${round(p.x)} ${round(p.y)}`).join(' ') +
    ` L ${round(last.x)} ${round(baselineY)} Z`;

  return { width, height, pad, points, linePoints, areaPath, maxCostUsd };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fraction of a budget consumed, clamped to [0, 1] for bar width. Returns 0
 * for a non-positive limit so an unconfigured limit never renders a full bar.
 */
export function budgetFraction(spentUsd: number, limitUsd: number): number {
  if (!(limitUsd > 0)) return 0;
  const f = spentUsd / limitUsd;
  if (!Number.isFinite(f) || f < 0) return 0;
  return f > 1 ? 1 : f;
}

/** Severity tier for a budget bar's color, by spend-to-limit ratio. */
export type BudgetSeverity = 'ok' | 'warn' | 'over';

/** Map spend-to-limit ratio to a color tier (>=1 over, >=0.8 warn, else ok). */
export function budgetSeverity(spentUsd: number, limitUsd: number): BudgetSeverity {
  if (!(limitUsd > 0)) return 'ok';
  const ratio = spentUsd / limitUsd;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}
