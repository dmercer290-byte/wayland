/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WebhookExposureService - resolves the public base URL a webhook channel
 * should advertise to its provider.
 *
 * Precedence (ported from OpenClaw runtime.ts ~424-457):
 *   1. A user-supplied public URL (highest priority; never overridden).
 *   2. The tunnel, IF the opt-in flag is on (default OFF) - lazily starts a
 *      cloudflared quick tunnel in front of the webhook server port.
 *   3. Otherwise: no public URL. For a provider that requires one (twilio),
 *      `resolveExposure` returns a not-configured status so the channel can
 *      surface "needs a public URL or enable the tunnel" instead of silently
 *      advertising an unreachable loopback URL.
 *
 * SECURITY: the tunnel opt-in defaults OFF because turning it on spawns a child
 * process and opens a public ingress. Even with a public URL, the channel MUST
 * keep verifying the provider signature on every inbound webhook - this service
 * only decides reachability, never trust.
 *
 * This service is a singleton keyed by webhook port: a single cloudflared
 * tunnel fronts the shared webhook server, so all webhook channels reuse it.
 */

import { startTunnel, stopAllTunnels } from './TunnelManager';
import { isProviderUnreachableWebhookUrl, providerRequiresPublicWebhook } from './webhookExposureGuard';
import type { TunnelHandle, TunnelProvider } from './types';

/**
 * Inputs for {@link resolveExposure}.
 */
export type ResolveExposureInput = {
  /** Channel platform requesting exposure, e.g. `sms-twilio`. */
  platform: string;
  /** Local webhook server port the tunnel should front. */
  webhookPort: number;
  /** Operator opt-in: may we spawn a tunnel and open a public ingress? */
  tunnelEnabled: boolean;
  /** Optional user-supplied public base URL (no trailing slash needed). */
  userPublicUrl?: string;
  /** Tunnel provider override. Defaults to cloudflared. */
  tunnelProvider?: TunnelProvider;
};

/**
 * Result of resolving webhook exposure.
 *
 * `configured: false` means there is no reachable public URL for a provider
 * that requires one - the channel should show an actionable "needs URL/tunnel"
 * status and NOT advertise a loopback URL.
 */
export type ExposureStatus = {
  /** True when a usable public base URL is available. */
  configured: boolean;
  /** The resolved public base URL when `configured`, else null. */
  publicUrl: string | null;
  /** How the URL was obtained. */
  source: 'user' | 'tunnel' | 'none';
  /** Operator-facing explanation of the status. */
  message: string;
};

/** Singleton tunnel handle, keyed by the port it fronts. */
let activeTunnel: { port: number; handle: TunnelHandle } | null = null;
/** In-flight start promise, so concurrent callers share one tunnel. */
let startInFlight: Promise<TunnelHandle> | null = null;
let shutdownHooked = false;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Lazily start (or reuse) the shared cloudflared tunnel for `port`.
 * Concurrent callers await the same in-flight start.
 */
async function ensureTunnel(port: number, provider: TunnelProvider | undefined): Promise<TunnelHandle> {
  if (activeTunnel && activeTunnel.port === port) {
    return activeTunnel.handle;
  }
  if (startInFlight) {
    return startInFlight;
  }
  registerShutdownHook();
  startInFlight = startTunnel({ port, provider })
    .then((handle) => {
      activeTunnel = { port, handle };
      return handle;
    })
    .finally(() => {
      startInFlight = null;
    });
  return startInFlight;
}

/** Register a one-time app-shutdown hook to reap tunnels. */
function registerShutdownHook(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  try {
    // Lazy require so the module stays importable in non-electron test contexts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { once?: (e: string, cb: () => void) => void } };
    electron.app?.once?.('before-quit', () => {
      void stopAllTunnels();
    });
  } catch {
    /* non-electron context: stopExposure() must be called explicitly */
  }
}

/**
 * Resolve the public webhook base URL for a channel, starting a tunnel when
 * the opt-in is on and no user URL is supplied.
 *
 * Never throws for the "no public URL" case - it returns `configured: false`
 * so the channel can surface a status instead of failing hard. It DOES surface
 * a tunnel start failure as `configured: false` with the error message.
 */
export async function resolveExposure(input: ResolveExposureInput): Promise<ExposureStatus> {
  const requiresPublic = providerRequiresPublicWebhook(input.platform);

  // 1. User-supplied URL wins. Validate reachability for providers that need it.
  if (input.userPublicUrl && input.userPublicUrl.trim().length > 0) {
    const url = trimTrailingSlash(input.userPublicUrl.trim());
    if (requiresPublic && isProviderUnreachableWebhookUrl(url)) {
      return {
        configured: false,
        publicUrl: null,
        source: 'user',
        message: `The configured public URL is local-only or not https and cannot be reached by ${input.platform}: ${url}`,
      };
    }
    return {
      configured: true,
      publicUrl: url,
      source: 'user',
      message: `Using configured public URL: ${url}`,
    };
  }

  // 2. Tunnel, only if the operator opted in.
  if (input.tunnelEnabled) {
    try {
      const handle = await ensureTunnel(input.webhookPort, input.tunnelProvider);
      const url = trimTrailingSlash(handle.publicUrl);
      return {
        configured: true,
        publicUrl: url,
        source: 'tunnel',
        message: `Webhook exposed through ${handle.provider} tunnel: ${url}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        configured: false,
        publicUrl: null,
        source: 'tunnel',
        message: `Tunnel start failed: ${message}`,
      };
    }
  }

  // 3. Nothing configured.
  if (requiresPublic) {
    return {
      configured: false,
      publicUrl: null,
      source: 'none',
      message:
        `${input.platform} needs a publicly reachable webhook URL. ` +
        'Set a public URL or enable the channel tunnel opt-in (it stays off by default ' +
        'because it opens a public ingress; the provider signature stays enforced).',
    };
  }

  return {
    configured: false,
    publicUrl: null,
    source: 'none',
    message: 'No public webhook URL configured (this channel does not require one).',
  };
}

/**
 * Build the full inbound webhook URL a provider should call, given a resolved
 * public base, the channel platform, and the connection token.
 *
 * Mirrors the route shape mounted by `mountWebhookRoutes`:
 *   <base>/webhooks/<platform>/<connectionToken>
 */
export function buildWebhookUrl(publicBaseUrl: string, platform: string, connectionToken: string): string {
  return `${trimTrailingSlash(publicBaseUrl)}/webhooks/${platform}/${connectionToken}`;
}

/** Stop the shared tunnel (if any). Safe to call when none is running. */
export async function stopExposure(): Promise<void> {
  const current = activeTunnel;
  activeTunnel = null;
  if (current) {
    await current.handle.stop().catch((): void => undefined);
  }
}

/** Test-only reset of singleton state. */
export function __resetExposureForTest(): void {
  activeTunnel = null;
  startInFlight = null;
  shutdownHooked = false;
}
