/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { findAssistantInRegistry, SignalCollector } from './SignalCollector';
import { dateKey, hashSeed, seededShuffle } from './seededShuffle';
import {
  THREAD_MIN_DURATION_MS,
  THREAD_MIN_MESSAGES,
  type KickoffAlternate,
  type KickoffCascadeLevel,
  type KickoffCascadeReason,
  type KickoffEntry,
  type KickoffResult,
  type KickoffSignals,
  type KickoffSuggestion,
} from './types';

/**
 * Walks the 5-level cascade defined in the v0.4.7 Kickoff handoff. First
 * match wins; never composes from multiple levels. Levels 1-4 each return
 * a single suggestion + up to 2 same-scenario alternates for the
 * "Something else" redirect ladder. Level 5 = `notRendered` → bare input.
 *
 * Cascade levels (handoff §1):
 *   1. Standing Company ritual fired in last 4h          (gated by requiresRitualOutput)
 *   2. Recent thread continuation (≥3 msgs, ≥2 min, not auto-titled)
 *   3. Cold-start library entry (time-bucket filtered, seeded shuffle)
 *   4. Beginner-touch fallback (beginnerSafe entries)
 *
 * Determinism: level 3's seed is `hash(installUuid + assistantId + dateKey)`
 * so the same install on the same day sees the same primary suggestion.
 * Different installUuids produce different orderings — verified in
 * SuggestionEngine.test.ts.
 */
export type RegistryFinder = (assistantId: string) => Record<string, unknown> | null;

export class SuggestionEngine {
  constructor(
    private readonly signalCollector: SignalCollector,
    private readonly registryFinder: RegistryFinder = findAssistantInRegistry
  ) {}

  async suggest(assistantId: string, now?: number): Promise<KickoffResult> {
    const assistant = this.registryFinder(assistantId);
    if (!assistant) return { notRendered: 'unknown-assistant' };

    const kickoffs = readKickoffArray(assistant);
    if (kickoffs.length === 0) return { notRendered: 'no-kickoffs-defined' };

    const signals = await this.signalCollector.collect(assistantId, now);

    // Level 1 — Standing ritual fired recently
    if (signals.hasStandingRitualFiredRecently) {
      const candidate = kickoffs.find((k) => k.scenario === 'post-fire-ritual' && k.requiresRitualOutput === true);
      if (candidate) return buildSuggestion(1, 'standing-ritual-fired', candidate, kickoffs);
    }

    // Level 2 — Recent quality thread
    const recent = pickQualityThread(signals);
    if (recent) {
      const candidate = kickoffs.find((k) => k.scenario === 'continuation-friendly');
      if (candidate) return buildSuggestion(2, 'recent-thread-quality-passed', candidate, kickoffs);
    }

    // Level 3 — Cold-start library, time-bucket filtered, seeded shuffle
    const coldStarts = kickoffs.filter(
      (k) => k.scenario === 'cold-start' && k.beginnerSafe !== true && (!k.timeBucket || k.timeBucket === signals.timeBucket)
    );
    if (coldStarts.length > 0) {
      const seed = hashSeed(`${signals.installUuid}:${assistantId}:${dateKey(signals.now)}`);
      const shuffled = seededShuffle(coldStarts, seed);
      const primary = shuffled[0]!;
      return buildSuggestion(3, 'cold-start-library', primary, kickoffs);
    }

    // Level 4 — Beginner touch fallback
    const beginner = kickoffs.find((k) => k.beginnerSafe === true);
    if (beginner) return buildSuggestion(4, 'beginner-touch-fallback', beginner, kickoffs);

    return { notRendered: 'all-levels-missed' };
  }
}

function pickQualityThread(signals: KickoffSignals): KickoffSignals['assistantRecentConversations'][number] | null {
  for (const conv of signals.assistantRecentConversations) {
    if (
      conv.messageCount >= THREAD_MIN_MESSAGES &&
      conv.durationMs >= THREAD_MIN_DURATION_MS &&
      !conv.isAutoTitled
    ) {
      return conv;
    }
  }
  return null;
}

function buildSuggestion(
  level: KickoffCascadeLevel,
  reason: KickoffCascadeReason,
  primary: KickoffEntry,
  all: KickoffEntry[]
): KickoffSuggestion {
  const alternates: KickoffAlternate[] = all
    .filter((k) => k.id !== primary.id && k.scenario === primary.scenario)
    .slice(0, 2)
    .map((k) => ({ kickoffId: k.id, text: k.text, prefill: k.prefill }));
  return {
    cascadeLevel: level,
    cascadeReason: reason,
    kickoffId: primary.id,
    text: primary.text,
    prefill: primary.prefill,
    alternates,
  };
}

function readKickoffArray(raw: Record<string, unknown>): KickoffEntry[] {
  const candidate = raw.kickoffs;
  if (!Array.isArray(candidate)) return [];
  const out: KickoffEntry[] = [];
  for (const entry of candidate) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id : '';
    const text = typeof e.text === 'string' ? e.text : '';
    const prefill = typeof e.prefill === 'string' ? e.prefill : '';
    const scenario = typeof e.scenario === 'string' ? e.scenario : '';
    if (!id || !text || !prefill) continue;
    if (scenario !== 'cold-start' && scenario !== 'continuation-friendly' && scenario !== 'post-fire-ritual') continue;
    out.push({
      id,
      text,
      prefill,
      scenario,
      timeBucket:
        e.timeBucket === 'morning' || e.timeBucket === 'afternoon' || e.timeBucket === 'evening'
          ? e.timeBucket
          : undefined,
      requiresRitualOutput: e.requiresRitualOutput === true ? true : undefined,
      beginnerSafe: e.beginnerSafe === true ? true : undefined,
    });
  }
  return out;
}
