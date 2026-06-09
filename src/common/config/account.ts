/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Multi-account per provider (issue #14, Phase 1a).
 *
 * A provider can hold more than one connected credential ("account"). A model
 * binding carries which account it targets as a STRUCTURED field - never a
 * serialized `${providerId}#${accountId}:${modelId}` string, because real model
 * ids contain colons (`qwen3-coder:free`) and provider ids are an open brand
 * (audit C2). The single-account case (everything today) is the implicit
 * `'default'` account, so existing bindings keep working untouched.
 */

/** The implicit account every provider has before any second key is added. */
export const DEFAULT_ACCOUNT_ID = 'default';

/**
 * Normalize a binding's optional `accountId` to a concrete account id. An
 * absent / blank value resolves to {@link DEFAULT_ACCOUNT_ID} so a binding
 * persisted before multi-account existed (or one that simply never set an
 * account) always targets the single-account row.
 */
export function resolveAccountId(binding?: { accountId?: string | null } | null): string {
  const id = binding?.accountId;
  return typeof id === 'string' && id.trim().length > 0 ? id : DEFAULT_ACCOUNT_ID;
}
