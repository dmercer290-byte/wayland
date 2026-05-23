/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic seeded shuffle for the kickoff cold-start cascade. Same
 * seed → same order, so a fresh launch on the same calendar day surfaces
 * the same primary suggestion (intentional curation feel). Different
 * install-UUIDs produce different orderings (verified by tests in
 * SuggestionEngine.test.ts).
 *
 * Uses a 32-bit FNV-1a hash to derive a uint32 seed from the input string,
 * then mulberry32 as the PRNG. Both are public-domain primitives; chosen
 * for: zero external dependency, deterministic across platforms,
 * negligible cost relative to the IPC round-trip that produced the call.
 */

export function hashSeed(input: string): number {
  // FNV-1a 32-bit hash.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function dateKey(now: number, tzOffsetMinutes?: number): string {
  // Default to local timezone of the calling process; honor caller-supplied
  // offset (test fixtures use this to assert reproducible per-day bucketing
  // without depending on the host TZ).
  const offset = tzOffsetMinutes ?? -new Date(now).getTimezoneOffset();
  const local = new Date(now + offset * 60_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function timeBucketFor(now: number): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date(now).getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
