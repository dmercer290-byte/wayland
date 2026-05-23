/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { SuggestionEngine } from '@process/services/kickoff/SuggestionEngine';
import type { KickoffSignals } from '@process/services/kickoff/types';

// ----------------------------------------------------------------------------
// Fixtures: a representative assistant record matching the bundle shape
// (after Phase 1 wiring). Mirrors how ExtensionRegistry.getAssistants()
// would return it. Authoring it inline keeps the engine test pure-unit —
// no DB, no extension loader, no IPC.
// ----------------------------------------------------------------------------

const FIXTURE_ASSISTANT = {
  id: 'helm',
  name: 'Coach',
  kickoffs: [
    {
      id: 'standing-recap',
      text: 'Your team wrapped this morning. Want the recap?',
      prefill: 'Walk me through what shipped + the one decision waiting.',
      scenario: 'post-fire-ritual' as const,
      requiresRitualOutput: true,
    },
    {
      id: 'morning-cold',
      text: 'Want me to surface the decision you have been carrying?',
      prefill: 'Surface the decision.',
      scenario: 'cold-start' as const,
      timeBucket: 'morning' as const,
    },
    {
      id: 'morning-cold-2',
      text: 'Want me to prep your 1:1 agendas?',
      prefill: 'Prep 1:1 agendas.',
      scenario: 'cold-start' as const,
      timeBucket: 'morning' as const,
    },
    {
      id: 'afternoon-cold',
      text: 'Want me to put both sides of the tradeoff on the table?',
      prefill: 'Put both sides on the table.',
      scenario: 'cold-start' as const,
      timeBucket: 'afternoon' as const,
    },
    {
      id: 'continuation',
      text: 'Picking up from your last session?',
      prefill: 'Continue where we left off.',
      scenario: 'continuation-friendly' as const,
    },
    {
      id: 'beginner',
      text: 'First time? I will show you 3 decisions in 10 minutes.',
      prefill: 'Show me 3 starter decisions.',
      scenario: 'cold-start' as const,
      timeBucket: 'morning' as const,
      beginnerSafe: true,
    },
  ],
};

const finderFor = (record: Record<string, unknown> | null) => () => record;

function signalsBase(now: number = new Date('2026-05-23T09:00:00').getTime()): KickoffSignals {
  return {
    now,
    timeBucket: 'morning',
    installUuid: 'install-A-FFFF',
    assistantRecentConversations: [],
    hasStandingRitualFiredRecently: false,
  };
}

function makeEngine(signals: KickoffSignals, record: Record<string, unknown> | null = FIXTURE_ASSISTANT) {
  const collector = { collect: vi.fn().mockResolvedValue(signals) } as unknown as ConstructorParameters<
    typeof SuggestionEngine
  >[0];
  return new SuggestionEngine(collector, finderFor(record));
}

describe('SuggestionEngine — cascade', () => {
  it('returns notRendered=unknown-assistant when the registry has no match', async () => {
    const engine = makeEngine(signalsBase(), null);
    const result = await engine.suggest('ghost-assistant');
    expect(result).toEqual({ notRendered: 'unknown-assistant' });
  });

  it('returns notRendered=no-kickoffs-defined when the assistant ships an empty kickoffs array', async () => {
    const engine = makeEngine(signalsBase(), { id: 'helm', kickoffs: [] });
    const result = await engine.suggest('helm');
    expect(result).toEqual({ notRendered: 'no-kickoffs-defined' });
  });

  it('cold install with no signals falls through to level 3 cold-start in the matching time bucket', async () => {
    const engine = makeEngine(signalsBase());
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error(`expected suggestion, got ${result.notRendered}`);
    expect(result.cascadeLevel).toBe(3);
    expect(result.cascadeReason).toBe('cold-start-library');
    // Primary must be one of the two morning cold-start (non-beginner) entries.
    expect(['morning-cold', 'morning-cold-2']).toContain(result.kickoffId);
  });

  it('thread quality gate: 5 messages over 3 minutes with non-auto subject → level 2', async () => {
    const signals = signalsBase();
    signals.assistantRecentConversations = [
      {
        id: 'c1',
        modifyTime: signals.now,
        messageCount: 5,
        durationMs: 3 * 60 * 1000,
        subject: 'Decision: shut down Q3 pilot or extend?',
        isAutoTitled: false,
      },
    ];
    const engine = makeEngine(signals);
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.cascadeLevel).toBe(2);
    expect(result.kickoffId).toBe('continuation');
  });

  it('thread quality gate fails on short thread → falls through to level 3', async () => {
    const signals = signalsBase();
    signals.assistantRecentConversations = [
      {
        id: 'c1',
        modifyTime: signals.now,
        messageCount: 2,
        durationMs: 30 * 1000,
        subject: 'Quick hello',
        isAutoTitled: false,
      },
    ];
    const engine = makeEngine(signals);
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.cascadeLevel).toBe(3);
  });

  it('thread quality gate fails on auto-titled subject → falls through to level 3', async () => {
    const signals = signalsBase();
    signals.assistantRecentConversations = [
      {
        id: 'c1',
        modifyTime: signals.now,
        messageCount: 10,
        durationMs: 10 * 60 * 1000,
        subject: 'New Conversation',
        isAutoTitled: true,
      },
    ];
    const engine = makeEngine(signals);
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.cascadeLevel).toBe(3);
  });

  it('Standing ritual fired recently → level 1 with the post-fire-ritual gated card', async () => {
    const signals = signalsBase();
    signals.hasStandingRitualFiredRecently = true;
    const engine = makeEngine(signals);
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.cascadeLevel).toBe(1);
    expect(result.cascadeReason).toBe('standing-ritual-fired');
    expect(result.kickoffId).toBe('standing-recap');
  });

  it('Standing ritual fired but no requiresRitualOutput card defined → falls through to level 3', async () => {
    const signals = signalsBase();
    signals.hasStandingRitualFiredRecently = true;
    const record = {
      ...FIXTURE_ASSISTANT,
      // Drop the standing-recap so level 1 has no candidate.
      kickoffs: FIXTURE_ASSISTANT.kickoffs.filter((k) => k.scenario !== 'post-fire-ritual'),
    };
    const engine = makeEngine(signals, record);
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.cascadeLevel).toBe(3);
  });

  it('time bucket filtering: afternoon signal returns the afternoon cold-start, not morning ones', async () => {
    const signals = signalsBase(new Date('2026-05-23T15:00:00').getTime());
    signals.timeBucket = 'afternoon';
    const engine = makeEngine(signals);
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.kickoffId).toBe('afternoon-cold');
  });

  it('only beginner-safe entries available → level 4 beginner-touch fallback', async () => {
    const signals = signalsBase();
    signals.timeBucket = 'evening'; // no evening cold-starts in fixture
    // Strip all non-beginner cards so level 3 has nothing.
    const record = {
      ...FIXTURE_ASSISTANT,
      kickoffs: FIXTURE_ASSISTANT.kickoffs.filter((k) => k.beginnerSafe === true),
    };
    const engine = makeEngine(signals, record);
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.cascadeLevel).toBe(4);
    expect(result.cascadeReason).toBe('beginner-touch-fallback');
    expect(result.kickoffId).toBe('beginner');
  });

  it('all levels miss → notRendered=all-levels-missed', async () => {
    const signals = signalsBase();
    signals.timeBucket = 'evening';
    const record = { id: 'helm', kickoffs: [FIXTURE_ASSISTANT.kickoffs[3]] }; // afternoon-cold only
    const engine = makeEngine(signals, record);
    const result = await engine.suggest('helm');
    expect(result).toEqual({ notRendered: 'all-levels-missed' });
  });

  it('alternates list excludes the primary and is capped at 2 entries from the same scenario', async () => {
    const engine = makeEngine(signalsBase());
    const result = await engine.suggest('helm');
    if ('notRendered' in result) throw new Error('expected suggestion');
    expect(result.alternates.length).toBeLessThanOrEqual(2);
    expect(result.alternates.find((a) => a.kickoffId === result.kickoffId)).toBeUndefined();
  });
});

describe('SuggestionEngine — deterministic shuffle', () => {
  it('same installUuid + same dateKey + same assistantId → same primary', async () => {
    const sigA = signalsBase();
    const sigB = signalsBase();
    const engineA = makeEngine(sigA);
    const engineB = makeEngine(sigB);
    const a = await engineA.suggest('helm');
    const b = await engineB.suggest('helm');
    if ('notRendered' in a || 'notRendered' in b) throw new Error('expected suggestions');
    expect(a.kickoffId).toBe(b.kickoffId);
  });

  it('different installUuid → can produce a different primary (entropy verified)', async () => {
    const seen = new Set<string>();
    for (const uuid of ['install-A-FFFF', 'install-B-1111', 'install-C-9999', 'install-D-4242']) {
      const sig = signalsBase();
      sig.installUuid = uuid;
      const engine = makeEngine(sig);
      const result = await engine.suggest('helm');
      if ('notRendered' in result) throw new Error('expected suggestion');
      seen.add(result.kickoffId);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('same installUuid on different days → primaries can differ', async () => {
    const day1 = signalsBase(new Date('2026-05-23T09:00:00').getTime());
    const day2 = signalsBase(new Date('2026-06-15T09:00:00').getTime());
    const a = await makeEngine(day1).suggest('helm');
    const b = await makeEngine(day2).suggest('helm');
    if ('notRendered' in a || 'notRendered' in b) throw new Error('expected suggestions');
    // We don't require them to differ on every pair, but at minimum the
    // dateKey participates in the hash — assert by computing the shuffle
    // a third day from the same install and proving span > 1 across days.
    const day3 = signalsBase(new Date('2026-07-04T09:00:00').getTime());
    const c = await makeEngine(day3).suggest('helm');
    if ('notRendered' in c) throw new Error('expected suggestion');
    const ids = new Set([a.kickoffId, b.kickoffId, c.kickoffId]);
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });
});
