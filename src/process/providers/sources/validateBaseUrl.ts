/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider `baseUrl` validation (main process).
 *
 * Used at provider-save AND at refresh time to gate where the catalog fetcher
 * is allowed to talk. Auto-refresh skips providers whose saved base fails this
 * check - an unattended background fetch must never be pointed at a loopback,
 * link-local, or private-network literal (SSRF surface).
 *
 * Rules:
 *  - Must parse as a URL with an `https:` scheme.
 *  - `http:` is allowed ONLY for `localhost` / `127.0.0.1` and ONLY outside
 *    production (`NODE_ENV !== 'production'`) - a dev convenience, never shipped.
 *  - Any loopback / link-local / private-IP literal host is rejected outright
 *    (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fc00::/7,
 *    fe80::/10), as is any non-http(s) scheme.
 *
 * Pure - no I/O, no DNS resolution, no deps. A hostname that *resolves* to a
 * private IP is a separate (DNS-rebinding) concern handled at fetch time.
 */

import { isLoopbackOrPrivateHost, normalizeHostLiteral } from '@/common/utils/urlValidation';

export type BaseUrlValidation = { ok: true } | { ok: false; reason: string };

/** Validate a provider base URL. Pure; returns a typed pass/fail with a reason. */
export function validateProviderBaseUrl(baseUrl: string): BaseUrlValidation {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    return { ok: false, reason: 'empty' };
  }

  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  const scheme = url.protocol;
  if (scheme !== 'https:' && scheme !== 'http:') {
    return { ok: false, reason: `scheme-not-allowed:${scheme.replace(/:$/, '')}` };
  }

  const host = normalizeHostLiteral(url.hostname);

  if (scheme === 'http:') {
    const isDevLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (isDevLoopback && !isProduction()) {
      return { ok: true };
    }
    return { ok: false, reason: 'http-not-allowed' };
  }

  // https: - still reject literal loopback / link-local / private-IP hosts so
  // auto-refresh can never be aimed inside the local network. Uses the single
  // canonical classifier (shared with the keyless gate).
  if (isLoopbackOrPrivateHost(host)) {
    return { ok: false, reason: 'private-host' };
  }

  return { ok: true };
}

// ─── Pure helpers ───────────────────────────────────────────────────────────────

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
