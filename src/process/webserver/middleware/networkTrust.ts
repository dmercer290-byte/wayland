/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Network-provenance trust classification for the remote WebUI (#83).
 *
 * The desktop app reaches storage actions over IPC and is fully trusted. The
 * WebUI reaches them over HTTP, where "remote" is not one trust level: the owner
 * on their own machine - over loopback, their LAN, or a Tailscale tailnet -
 * should get full operator capability, while a request arriving from the open
 * internet should be restricted to non-destructive actions.
 *
 * We judge each request by the IP of its DIRECT socket peer (Express has no
 * `trust proxy` set, so `req.socket.remoteAddress` is the immediate connection,
 * not a spoofable `X-Forwarded-For`). A request from a private-network address
 * is treated as the operator; a public address is restricted.
 *
 * This is intentionally only ONE factor. Destructive actions (Restore, Reset)
 * additionally require a step-up password re-auth, so even if a reverse proxy on
 * a public host makes every request appear to originate from `127.0.0.1`
 * (over-granting operator), an attacker still cannot run a destructive action
 * without the WebUI password. Operators who DO front Wayland with a proxy on a
 * public host should configure Express `trust proxy` so the real client IP is
 * classified instead of the proxy's loopback address.
 */

export type NetworkTrust = 'operator' | 'restricted';

/**
 * Strip an IPv4-mapped IPv6 prefix (`::ffff:192.168.1.5` -> `192.168.1.5`) and
 * surrounding whitespace/zone-id so the range checks see a bare address.
 */
function normalizeIp(ip: string): string {
  let value = ip.trim().toLowerCase();
  // Drop an IPv6 zone id (e.g. `fe80::1%eth0`).
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  // IPv4-mapped IPv6.
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  return value;
}

/** Parse a dotted IPv4 string into its four octets, or null if malformed. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p)) return NaN;
    return Number(p);
  });
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * Whether an IP belongs to a private/trusted network: loopback, RFC1918 LAN,
 * the Tailscale CGNAT range (100.64.0.0/10), link-local, or IPv6 unique-local.
 * Unparseable or public addresses return false (fail safe to restricted).
 */
export function isPrivateNetworkIp(rawIp: string | undefined | null): boolean {
  if (!rawIp) return false;
  const ip = normalizeIp(rawIp);

  // IPv6 forms we treat as private/trusted.
  if (ip === '::1') return true; // loopback
  if (ip.startsWith('fe80:')) return true; // link-local
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique-local fc00::/7

  const octets = parseIpv4(ip);
  if (!octets) return false;
  const [a, b] = octets;

  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (Tailscale CGNAT)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local

  return false;
}

/**
 * Classify a request's direct-peer IP as `operator` (private network: the owner
 * on loopback/LAN/Tailscale) or `restricted` (public internet).
 */
export function classifyClientTrust(rawIp: string | undefined | null): NetworkTrust {
  return isPrivateNetworkIp(rawIp) ? 'operator' : 'restricted';
}
