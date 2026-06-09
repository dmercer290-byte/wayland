/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local-only-URL guard for webhook channels.
 *
 * Ported from OpenClaw's `webhook-exposure.ts`: some providers (Twilio first;
 * Telnyx / Plivo later) sign webhooks and call back into us over the public
 * internet. If we hand them a loopback / private-network URL they can never
 * reach it, so the channel is silently dead. This guard refuses to start such
 * a channel with a local-only URL and surfaces an actionable error instead.
 *
 * SECURITY NOTE: this guard is about *reachability*, never about *trust*. A
 * publicly reachable URL is still only safe because the channel verifies the
 * provider's signature on every inbound request. Opening a tunnel does not
 * relax that requirement.
 */

import { isIP } from 'node:net';

/**
 * Channel platforms that require a publicly reachable webhook URL because the
 * provider POSTs signed callbacks to us from its own infrastructure.
 */
const PUBLIC_WEBHOOK_PLATFORMS = new Set<string>(['sms-twilio', 'twilio', 'telnyx', 'plivo']);

/**
 * True when the given channel platform needs a publicly reachable webhook URL.
 */
export function providerRequiresPublicWebhook(platform: string | undefined): boolean {
  if (!platform) return false;
  return PUBLIC_WEBHOOK_PLATFORMS.has(platform);
}

/**
 * True when `hostname` is loopback, an RFC1918 / CGNAT / link-local address,
 * a `.local` / `.internal` name, or an unqualified single-label host - i.e. a
 * host no external provider can reach.
 *
 * Synchronous and literal-only (no DNS): callers pass a URL they are about to
 * advertise, so we judge the literal hostname. DNS-rebinding style checks are
 * handled separately by the receiver's SSRF guard for outbound fetches.
 */
export function isLocalOnlyWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home')) return true;

  const family = isIP(host);
  if (family === 4) return isReservedIPv4(host);
  if (family === 6) return isReservedIPv6(host);

  // A single-label, non-IP host (no dot) is not publicly resolvable.
  if (!host.includes('.')) return true;

  return false;
}

/**
 * True when the given webhook URL points at a host no provider can reach.
 * A URL that fails to parse is treated as unreachable (fail closed).
 */
export function isProviderUnreachableWebhookUrl(webhookUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    return true;
  }
  // Providers require https for signed callbacks; plain http is treated as
  // unreachable so we never advertise an unverifiable transport.
  if (parsed.protocol !== 'https:') return true;
  return isLocalOnlyWebhookHost(parsed.hostname);
}

/**
 * Throw if `webhookUrl` is local-only and `platform` requires a public URL.
 * No-op for platforms that do not require public webhooks, or for reachable
 * URLs. The thrown message is operator-facing and actionable.
 */
export function assertPublicWebhookUrl(platform: string, webhookUrl: string): void {
  if (!providerRequiresPublicWebhook(platform)) return;
  if (!isProviderUnreachableWebhookUrl(webhookUrl)) return;
  throw new Error(
    `[tunnel] ${platform} requires a publicly reachable https webhook URL but got a ` +
      `local-only/unreachable URL: ${webhookUrl}. ` +
      'Set a public URL for the webhook server, or enable the channel tunnel opt-in so a ' +
      'cloudflared tunnel can expose it. The provider signature stays enforced either way.'
  );
}

/** RFC1918, loopback, link-local, CGNAT, "this network", broadcast. */
function isReservedIPv4(addr: string): boolean {
  const parts = addr.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 255 && b === 255) return true;
  return false;
}

/** Loopback (::1), link-local (fe80::/10), unique-local (fc00::/7), mapped IPv4. */
function isReservedIPv6(addr: string): boolean {
  const normalized = addr.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized === '::' || normalized === '::0') return true;
  if (/^fe[89ab][0-9a-f]?:/.test(normalized)) return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(normalized)) return true;
  const mapped = /^::ffff:([0-9.]+)$/.exec(normalized);
  if (mapped && mapped[1] && isIP(mapped[1]) === 4) {
    return isReservedIPv4(mapped[1]);
  }
  return false;
}
