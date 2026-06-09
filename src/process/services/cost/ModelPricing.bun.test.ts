/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/services/cost/ModelPricing.bun.test.ts
// Run with: bun test src/process/services/cost/ModelPricing.bun.test.ts
//
// Bun-runtime test for ModelPricing. Runs under bun (not vitest) because the
// module reads the real bundled `resources/modelsdev-snapshot.json` from the
// repo root via process.cwd(), and bun imports the module cleanly without the
// electron runtime (the electron require is guarded). Expected USD figures are
// computed by hand from the snapshot's cost.input / cost.output (USD per 1M
// tokens) for known models.

import { describe, it, expect } from 'bun:test';
import { ModelPricing } from './ModelPricing';

// Floating-point tolerance for hand-computed USD sums.
const within = (actual: number | undefined, expected: number): boolean =>
  actual != null && Math.abs(actual - expected) < 1e-9;

describe('ModelPricing.priceTokens', () => {
  it('prices a known model from input/output split (claude-opus-4-5: input 5, output 25 per 1M)', () => {
    const p = new ModelPricing();
    // 1,000,000 input * 5/1e6 + 500,000 output * 25/1e6 = 5 + 12.5 = 17.5
    const usd = p.priceTokens('claude-opus-4-5', { input: 1_000_000, output: 500_000 });
    expect(within(usd, 17.5)).toBe(true);
  });

  it('adds cacheRead at the dedicated cache_read rate when present (opus cache_read 0.5 per 1M)', () => {
    const p = new ModelPricing();
    // base 17.5 + 2,000,000 cacheRead * 0.5/1e6 = 17.5 + 1.0 = 18.5
    const usd = p.priceTokens('claude-opus-4-5', {
      input: 1_000_000,
      output: 500_000,
      cacheRead: 2_000_000,
    });
    expect(within(usd, 18.5)).toBe(true);
  });

  it('prices cacheRead at the input rate when the model has no cache_read rate (solar-mini input 0.15)', () => {
    const p = new ModelPricing();
    // 1,000,000 input * 0.15/1e6 + 0 output + 1,000,000 cacheRead * 0.15/1e6 = 0.15 + 0.15 = 0.30
    const usd = p.priceTokens('solar-mini', { input: 1_000_000, output: 0, cacheRead: 1_000_000 });
    expect(within(usd, 0.3)).toBe(true);
  });

  it('resolves a provider-prefixed model id by stripping the prefix (anthropic/claude-opus-4-5)', () => {
    const p = new ModelPricing();
    const usd = p.priceTokens('anthropic/claude-opus-4-5', { input: 1_000_000, output: 500_000 });
    expect(within(usd, 17.5)).toBe(true);
  });

  it('returns undefined for an unknown model id', () => {
    const p = new ModelPricing();
    expect(p.priceTokens('this-model-does-not-exist-xyz', { input: 1000, output: 1000 })).toBeUndefined();
  });

  it('returns undefined for an undefined model id', () => {
    const p = new ModelPricing();
    expect(p.priceTokens(undefined, { input: 1000, output: 1000 })).toBeUndefined();
  });

  it('does not re-read the snapshot per call (lazy singleton index)', () => {
    const p = new ModelPricing();
    const first = p.priceTokens('claude-opus-4-5', { input: 1_000_000, output: 0 });
    const second = p.priceTokens('claude-opus-4-5', { input: 1_000_000, output: 0 });
    expect(first).toBe(second);
    expect(within(first, 5)).toBe(true);
  });
});
