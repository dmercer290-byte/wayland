/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { dateKey, hashSeed, seededShuffle, timeBucketFor } from '@process/services/kickoff/seededShuffle';

describe('hashSeed', () => {
  it('is deterministic across calls with the same input', () => {
    expect(hashSeed('hello')).toBe(hashSeed('hello'));
  });

  it('produces different values for different inputs (no trivial collision)', () => {
    const seeds = new Set(['a', 'b', 'install-A:helm:2026-05-23', 'install-B:helm:2026-05-23'].map(hashSeed));
    expect(seeds.size).toBe(4);
  });
});

describe('seededShuffle', () => {
  it('same seed → same order', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
  });

  it('different seeds → different orders for non-trivial input', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const orderA = seededShuffle(items, 1).join(',');
    const orderB = seededShuffle(items, 99).join(',');
    expect(orderA).not.toBe(orderB);
  });

  it('does not mutate the input array', () => {
    const items = ['a', 'b', 'c'];
    const snapshot = items.slice();
    seededShuffle(items, 7);
    expect(items).toEqual(snapshot);
  });
});

describe('dateKey', () => {
  it('rolls over at local midnight', () => {
    const tzOffsetMinutes = 0; // pin to UTC for determinism
    const lastTickOfDay = Date.UTC(2026, 4, 23, 23, 59, 59);
    const firstTickOfNextDay = Date.UTC(2026, 4, 24, 0, 0, 0);
    expect(dateKey(lastTickOfDay, tzOffsetMinutes)).toBe('2026-05-23');
    expect(dateKey(firstTickOfNextDay, tzOffsetMinutes)).toBe('2026-05-24');
  });
});

describe('timeBucketFor', () => {
  it('classifies morning / afternoon / evening by local hour', () => {
    const at = (h: number) => new Date(2026, 4, 23, h, 0, 0).getTime();
    expect(timeBucketFor(at(8))).toBe('morning');
    expect(timeBucketFor(at(13))).toBe('afternoon');
    expect(timeBucketFor(at(20))).toBe('evening');
  });
});
