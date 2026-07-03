/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { QUICK_LAUNCH_ANCHORS, type QuickLaunchAnchorId } from '@/renderer/pages/guid/quickLaunchAnchors';

describe('QUICK_LAUNCH_ANCHORS', () => {
  it('defines exactly 7 anchors', () => {
    expect(QUICK_LAUNCH_ANCHORS).toHaveLength(7);
  });

  it('keeps Cowork as the first anchor (autonomous-execution button)', () => {
    expect(QUICK_LAUNCH_ANCHORS[0].id).toBe('cowork');
    expect(QUICK_LAUNCH_ANCHORS[0].assistantId).toBe('builtin-cowork');
    expect(QUICK_LAUNCH_ANCHORS[0].lucideIcon).toBe('zap');
  });

  it('pins Concierge as the second anchor (universal ask-anything entry point)', () => {
    expect(QUICK_LAUNCH_ANCHORS[1].id).toBe('concierge');
    expect(QUICK_LAUNCH_ANCHORS[1].assistantId).toBe('builtin-concierge');
    expect(QUICK_LAUNCH_ANCHORS[1].lucideIcon).toBe('sparkles');
  });

  it('every anchor has all required fields populated', () => {
    for (const anchor of QUICK_LAUNCH_ANCHORS) {
      expect(anchor.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(anchor.label).toBeTruthy();
      expect(anchor.label.length).toBeLessThanOrEqual(20);
      expect(anchor.sub).toBeTruthy();
      expect(anchor.sub.length).toBeLessThanOrEqual(28);
      expect(anchor.assistantId).toBeTruthy();
      expect(anchor.lucideIcon).toBeTruthy();
      // Concierge intentionally carries an empty prefill (free-form "ask
      // anything"); every other anchor seeds a deliberate prompt stub.
      if (anchor.id === 'concierge') {
        expect(anchor.prefill).toBe('');
      } else {
        expect(anchor.prefill).toBeTruthy();
        expect(anchor.prefill.length).toBeGreaterThan(2);
      }
    }
  });

  it('every anchor id is unique', () => {
    const ids = QUICK_LAUNCH_ANCHORS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exports a discriminated union of anchor ids', () => {
    const validIds: QuickLaunchAnchorId[] = [
      'concierge',
      'cowork',
      'write-copy',
      'close-deal',
      'launch-it',
      'numbers',
      'quiet-money',
    ];
    expect(validIds).toHaveLength(7);
  });
});
