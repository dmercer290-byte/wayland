/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rate-limit classification for scheduled-task run failures.
 *
 * Subscription-metered providers (Claude, Gemini, ChatGPT) expose two limit
 * shapes: a short rolling window (Claude/Gemini reset every ~5 hours) and a
 * long weekly cap. A window hit is worth waiting out - the task auto-retries
 * at reset. A weekly hit is not - the run should fail over to the user's
 * configured fallback model (OpenRouter / ZenMux / any provider) instead.
 *
 * Pure text classification (no I/O) - provider errors reach the cron layer
 * as flattened message strings, so this parses the common shapes and stays
 * conservative: anything ambiguous is 'window' (a deferred retry is always
 * safe; a wrong fallback switch is not).
 */

export type RateLimitClassification =
  | {
      kind: 'rate_limit';
      /** 'window' = short rolling window (retry at reset); 'weekly' = long cap (fail over). */
      scope: 'window' | 'weekly';
      /** Epoch ms to retry at. Parsed from the error when possible, else now + DEFAULT_WINDOW_MS. */
      retryAtMs: number;
    }
  | { kind: 'other' };

/** Claude/Gemini subscription windows reset every ~5 hours. */
export const DEFAULT_WINDOW_MS = 5 * 60 * 60 * 1000;

const RATE_LIMIT_SIGNALS =
  /\b429\b|rate.?limit|too many requests|quota exceeded|exceeded your current quota|resource.?exhausted|usage limit|out of capacity|overloaded_error/i;

const WEEKLY_SIGNALS = /\bweekly\b|\bweek\b|\bper.?week\b|7.?day/i;

/** "try again in 2 hours" / "retry after 90 minutes" / "resets in 30m" */
const RELATIVE_RESET =
  /(?:try again|retry|resets?|available)[^.\d]{0,20}(?:in|after)\s+(\d+(?:\.\d+)?)\s*(second|sec|s\b|minute|min|m\b|hour|hr|h\b)/i;

/** "Retry-After: 3600" style bare seconds. */
const RETRY_AFTER_SECONDS = /retry.?after[:\s]+(\d{1,6})(?!\d)/i;

function unitToMs(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('h')) return value * 3_600_000;
  if (u.startsWith('m') && !u.startsWith('ms')) return value * 60_000;
  return value * 1000;
}

/**
 * Classify a failed run's error text. `nowMs` is injected for testability.
 */
export function classifyRunError(message: string | undefined, nowMs: number): RateLimitClassification {
  if (!message || !RATE_LIMIT_SIGNALS.test(message)) return { kind: 'other' };

  const scope: 'window' | 'weekly' = WEEKLY_SIGNALS.test(message) ? 'weekly' : 'window';

  let delayMs: number | undefined;
  const relative = RELATIVE_RESET.exec(message);
  if (relative) {
    delayMs = unitToMs(Number(relative[1]), relative[2]);
  } else {
    const retryAfter = RETRY_AFTER_SECONDS.exec(message);
    if (retryAfter) delayMs = Number(retryAfter[1]) * 1000;
  }

  // Weekly caps have no useful short reset; retryAtMs is only meaningful for
  // window hits, but populate it anyway (callers may use it as a backstop).
  if (delayMs === undefined || !Number.isFinite(delayMs) || delayMs <= 0) {
    delayMs = scope === 'weekly' ? 7 * 24 * 3_600_000 : DEFAULT_WINDOW_MS;
  }
  return { kind: 'rate_limit', scope, retryAtMs: nowMs + delayMs };
}
