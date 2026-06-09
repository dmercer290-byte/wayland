/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { CostSeriesPoint } from '@process/services/cost/types';
import {
  budgetFraction,
  budgetSeverity,
  buildChartGeometry,
  PERIOD_BUCKET_MS,
  PERIOD_LENGTH_MS,
  periodToWindow,
} from '@renderer/pages/mission-control/cost/costChart';

function pt(bucketStart: number, costUsd: number): CostSeriesPoint {
  return { bucketStart, costUsd, tokensTotal: Math.round(costUsd * 1000), events: 1 };
}

describe('periodToWindow', () => {
  it('produces a one-period window ending at now', () => {
    const now = 1_000_000_000_000;
    expect(periodToWindow('day', now)).toEqual({ fromMs: now - PERIOD_LENGTH_MS.day, toMs: now });
    expect(periodToWindow('week', now)).toEqual({ fromMs: now - PERIOD_LENGTH_MS.week, toMs: now });
    expect(periodToWindow('month', now)).toEqual({ fromMs: now - PERIOD_LENGTH_MS.month, toMs: now });
  });

  it('uses hourly buckets for day and daily buckets for week/month', () => {
    expect(PERIOD_BUCKET_MS.day).toBe(60 * 60 * 1000);
    expect(PERIOD_BUCKET_MS.week).toBe(24 * 60 * 60 * 1000);
    expect(PERIOD_BUCKET_MS.month).toBe(24 * 60 * 60 * 1000);
  });
});

describe('buildChartGeometry', () => {
  it('returns empty geometry for no data', () => {
    const geo = buildChartGeometry([], 760, 200);
    expect(geo.points).toHaveLength(0);
    expect(geo.linePoints).toBe('');
    expect(geo.areaPath).toBe('');
    expect(geo.maxCostUsd).toBe(0);
  });

  it('maps the peak cost to the top of the inner box and zero to the baseline', () => {
    const series = [pt(0, 0), pt(1, 5), pt(2, 10)];
    const geo = buildChartGeometry(series, 760, 200);
    expect(geo.maxCostUsd).toBe(10);
    // Peak point sits at the inner top (pad.top); zero point sits at baseline.
    const top = geo.points[2];
    const zero = geo.points[0];
    expect(top.y).toBeCloseTo(geo.pad.top, 5);
    expect(zero.y).toBeCloseTo(geo.height - geo.pad.bottom, 5);
    // x spreads first -> left pad, last -> right edge.
    expect(geo.points[0].x).toBeCloseTo(geo.pad.left, 5);
    expect(geo.points[2].x).toBeCloseTo(geo.width - geo.pad.right, 5);
  });

  it('renders a flat baseline for a single point without dividing by zero', () => {
    const geo = buildChartGeometry([pt(0, 4)], 760, 200);
    expect(geo.points).toHaveLength(1);
    expect(Number.isFinite(geo.points[0].x)).toBe(true);
    expect(geo.linePoints).not.toBe('');
    // area path closes back to baseline
    expect(geo.areaPath).toContain('Z');
  });
});

describe('budgetFraction', () => {
  it('clamps to [0, 1] and guards a non-positive limit', () => {
    expect(budgetFraction(5, 10)).toBe(0.5);
    expect(budgetFraction(20, 10)).toBe(1);
    expect(budgetFraction(5, 0)).toBe(0);
    expect(budgetFraction(-5, 10)).toBe(0);
  });
});

describe('budgetSeverity', () => {
  it('tiers by spend-to-limit ratio', () => {
    expect(budgetSeverity(1, 10)).toBe('ok');
    expect(budgetSeverity(8, 10)).toBe('warn');
    expect(budgetSeverity(10, 10)).toBe('over');
    expect(budgetSeverity(12, 10)).toBe('over');
    expect(budgetSeverity(5, 0)).toBe('ok');
  });
});
