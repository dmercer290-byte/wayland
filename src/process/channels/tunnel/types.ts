/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Webhook tunnel manager - shared types.
 *
 * SECURITY: A tunnel spawns a child process AND opens a public ingress that
 * forwards inbound traffic to a local port. It is therefore gated behind an
 * explicit opt-in flag (default OFF) by every consumer, and the consuming
 * channel MUST keep enforcing its own webhook signature verification. The
 * tunnel only changes reachability; it provides NO authentication of its own.
 */

/**
 * Supported tunnel providers.
 *
 * - `cloudflared` (DEFAULT): cloudflare quick tunnel. No account/token needed.
 *   Quick tunnels do not expire on a fixed timer, which makes them the right
 *   default for an always-on desktop (unlike ngrok's free tier).
 * - `ngrok`: requires the ngrok CLI on PATH. Free tier sessions expire.
 * - `tailscale`: requires tailscale funnel to be enabled for the tailnet.
 */
export type TunnelProvider = 'cloudflared' | 'ngrok' | 'tailscale';

/** Default provider for an always-on desktop. */
export const DEFAULT_TUNNEL_PROVIDER: TunnelProvider = 'cloudflared';

/**
 * Options for {@link startTunnel}.
 */
export type StartTunnelOptions = {
  /** Local loopback port the tunnel should forward public traffic to. */
  port: number;
  /** Provider to use. Defaults to {@link DEFAULT_TUNNEL_PROVIDER}. */
  provider?: TunnelProvider;
  /**
   * Max time to wait for the public URL to appear in the child's output
   * before giving up and killing the child. Defaults to 30000 ms.
   */
  startupTimeoutMs?: number;
  /** Optional ngrok auth token (enables longer sessions / reserved domains). */
  ngrokAuthToken?: string;
};

/**
 * A running tunnel handle.
 */
export type TunnelHandle = {
  /** The public base URL, e.g. `https://random-words.trycloudflare.com`. */
  publicUrl: string;
  /** Provider that produced this tunnel. */
  provider: TunnelProvider;
  /** Tear the tunnel down. Idempotent; safe to call more than once. */
  stop: () => Promise<void>;
};
