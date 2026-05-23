/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// Live-smoke fix #1 (2026-05-19) — unit tests for the vendored-bundle
// runtime overlay. Confirms the overlay (a) injects missing schema
// fields, (b) is idempotent / non-destructive against already-populated
// fields, (c) handles both `ext-`-prefixed and unprefixed ids, and
// (d) leaves unknown assistants untouched.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyVendoredOverlay,
  __resetVendoredOverlayCacheForTests,
} from '@process/extensions/data/bundle-vendored/vendoredAssistantOverlay';

describe('applyVendoredOverlay', () => {
  beforeEach(() => {
    __resetVendoredOverlayCacheForTests();
  });

  it('injects standing + teammates + rituals onto a known standing-company entry whose live record lacks them', async () => {
    const assistants: Record<string, unknown>[] = [
      // The vendored manifest declares `marketing-agency` with standing:true,
      // a 5-element teammates roster, and a weekly-checkin ritual. The live
      // record here intentionally omits all three so we can see the overlay
      // hydrate them.
      {
        id: 'ext-marketing-agency',
        name: 'Marketing Agency',
        kind: 'team',
      },
    ];
    await applyVendoredOverlay(assistants);
    const patched = assistants[0];
    expect(patched.standing).toBe(true);
    expect(Array.isArray(patched.teammates)).toBe(true);
    expect((patched.teammates as string[]).length).toBeGreaterThan(0);
    expect(Array.isArray(patched.rituals)).toBe(true);
    expect((patched.rituals as Array<{ name: string }>)[0]?.name).toBe('weekly-checkin');
  });

  it('leaves already-populated fields untouched (overlay is non-destructive)', async () => {
    const assistants: Record<string, unknown>[] = [
      {
        id: 'ext-marketing-agency',
        standing: false, // explicit live override — must NOT be flipped by the overlay
        teammates: ['only-one'],
      },
    ];
    await applyVendoredOverlay(assistants);
    expect(assistants[0].standing).toBe(false);
    expect(assistants[0].teammates).toEqual(['only-one']);
    // rituals was missing on the input, so the overlay should still hydrate it.
    expect(Array.isArray(assistants[0].rituals)).toBe(true);
  });

  it('matches unprefixed ids as well as ext- prefixed ids', async () => {
    const assistants: Record<string, unknown>[] = [
      { id: 'dev-shop', name: 'Dev Shop' },
    ];
    await applyVendoredOverlay(assistants);
    expect(assistants[0].standing).toBe(true);
  });

  it('leaves assistants with no matching vendored entry unchanged', async () => {
    const assistants: Record<string, unknown>[] = [
      { id: 'ext-this-id-does-not-exist-anywhere', name: 'Phantom' },
    ];
    const before = JSON.stringify(assistants[0]);
    await applyVendoredOverlay(assistants);
    expect(JSON.stringify(assistants[0])).toBe(before);
  });

  it('preserves the non-standing flag on launchers the vendored bundle marks standing:false', async () => {
    const assistants: Record<string, unknown>[] = [
      // `cold-outbound` is a kind:team launcher with standing:false in the
      // vendored manifest. The overlay must propagate that explicit false
      // rather than leaving it unset (which the renderer reads as undefined).
      { id: 'ext-cold-outbound', name: 'Cold Outbound', kind: 'team' },
    ];
    await applyVendoredOverlay(assistants);
    expect(assistants[0].standing).toBe(false);
  });

  it('injects the kickoffs array onto a known assistant whose live record lacks it', async () => {
    // v0.4.7 — every vendored assistant ships with 7 kickoffs. Confirms the
    // overlay carries the new schema field across the dual-write boundary.
    const assistants: Record<string, unknown>[] = [{ id: 'ext-helm', name: 'Coach' }];
    await applyVendoredOverlay(assistants);
    const kickoffs = assistants[0].kickoffs as Array<{ id: string; scenario: string }> | undefined;
    expect(Array.isArray(kickoffs)).toBe(true);
    expect(kickoffs!.length).toBe(7);
    const ids = kickoffs!.map((k) => k.id);
    expect(ids).toContain('what-am-i-avoiding');
    expect(kickoffs!.every((k) => typeof k.id === 'string' && typeof k.scenario === 'string')).toBe(true);
  });

  it('preserves a live-record kickoffs override rather than clobbering with the bundle', async () => {
    // Overlay is non-destructive: if the running bundle already shipped its
    // own kickoffs (e.g. assistant-author update), the vendored snapshot must
    // not silently shadow them.
    const assistants: Record<string, unknown>[] = [
      {
        id: 'ext-helm',
        kickoffs: [{ id: 'live-override', text: 't', prefill: 'p', scenario: 'cold-start' }],
      },
    ];
    await applyVendoredOverlay(assistants);
    const kickoffs = assistants[0].kickoffs as Array<{ id: string }>;
    expect(kickoffs).toHaveLength(1);
    expect(kickoffs[0].id).toBe('live-override');
  });
});
