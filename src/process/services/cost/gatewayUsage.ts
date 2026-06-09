/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guarded parser for the OpenClaw/Remote gateway `chat:final` `usage` field.
 *
 * The gateway protocol declares `usage?: unknown` on its terminal ChatEvent
 * (see src/process/agent/openclaw/types.ts), but the field is untyped and has
 * no documented shape. We do NOT assume any shape and we do NOT fabricate a
 * total: this reads only the well-known per-turn token field names if and only
 * if they are concretely present as finite numbers, and returns undefined when
 * nothing usable is there.
 *
 * Token attribution only - these gateways do not surface a model id to the
 * manager, so the recorder cannot price the split. Callers record with
 * cost_source='unknown' (tokens only, never a priced unknown total).
 */
export type GatewayTurnTokens = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  /** True when at least one concrete numeric token field was found. */
  hasTokens: boolean;
};

function num(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract per-turn token counts from an untyped gateway `usage` payload.
 * Returns undefined when the payload is absent or carries no recognizable
 * numeric token field (the current always-absent reality until a gateway
 * build populates it).
 */
export function parseGatewayUsage(usage: unknown): GatewayTurnTokens | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as Record<string, unknown>;

  const inputTokens = num(record, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens');
  const outputTokens = num(record, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens');
  const cacheReadTokens = num(
    record,
    'cache_read_tokens',
    'cacheReadTokens',
    'cache_read_input_tokens',
    'cachedTokens'
  );

  if (inputTokens === undefined && outputTokens === undefined && cacheReadTokens === undefined) {
    return undefined;
  }

  return { inputTokens, outputTokens, cacheReadTokens, hasTokens: true };
}
