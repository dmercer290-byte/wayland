/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure parsers that pull the public URL out of a tunnel CLI's log output.
 *
 * Kept free of any process / IO so the brittle format-matching can be unit
 * tested directly against fixture log strings (no spawning binaries).
 */

/**
 * Match a cloudflared quick-tunnel URL. cloudflared prints the assigned URL to
 * stderr inside a boxed banner, e.g.:
 *
 *   INF +------------------------------------------------------------+
 *   INF |  Your quick Tunnel has been created! Visit it at ...        |
 *   INF |  https://random-words-here.trycloudflare.com                |
 *   INF +------------------------------------------------------------+
 *
 * The subdomain is randomly generated, so we match any `*.trycloudflare.com`
 * https URL anywhere in a chunk of output.
 */
const CLOUDFLARED_URL_REGEX = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i;

/**
 * Extract the first cloudflared quick-tunnel URL from a chunk of stdout/stderr.
 * Returns null when no URL is present (caller keeps buffering).
 */
export function parseCloudflaredUrl(chunk: string): string | null {
  const match = CLOUDFLARED_URL_REGEX.exec(chunk);
  return match ? match[0] : null;
}

/**
 * Extract the public URL from a single line of ngrok JSON log output.
 *
 * ngrok with `--log stdout --log-format json` emits one JSON object per line.
 * The tunnel-ready line looks like:
 *   {"lvl":"info","msg":"started tunnel","url":"https://abc123.ngrok-free.app",...}
 *
 * Returns the `url` value when the line is a tunnel-started event carrying an
 * https URL, else null. Non-JSON lines (banner text) return null and are
 * ignored by the caller.
 */
export function parseNgrokJsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const log = parsed as { msg?: unknown; url?: unknown; addr?: unknown };
  const url = typeof log.url === 'string' ? log.url : null;
  if (!url || !url.startsWith('https://')) return null;
  // The "started tunnel" message carries the public URL; some ngrok versions
  // also emit it alongside an `addr` (the local target). Accept either shape.
  if (log.msg === 'started tunnel' || typeof log.addr === 'string') {
    return url;
  }
  return null;
}
