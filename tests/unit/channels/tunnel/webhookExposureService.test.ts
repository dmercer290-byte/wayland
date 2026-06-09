/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// electron is not available in the test runtime; the service lazy-requires it.
vi.mock('electron', () => ({ app: { once: vi.fn() } }));

const startTunnel = vi.fn();
const stopAllTunnels = vi.fn(async () => undefined);
vi.mock('@process/channels/tunnel/TunnelManager', () => ({
  startTunnel: (...args: unknown[]) => startTunnel(...args),
  stopAllTunnels: () => stopAllTunnels(),
}));

import {
  __resetExposureForTest,
  buildWebhookUrl,
  resolveExposure,
} from '@process/channels/tunnel/WebhookExposureService';

describe('WebhookExposureService.resolveExposure', () => {
  beforeEach(() => {
    __resetExposureForTest();
    startTunnel.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefers a user-supplied public https url and never starts a tunnel', async () => {
    const status = await resolveExposure({
      platform: 'sms-twilio',
      webhookPort: 25808,
      tunnelEnabled: true,
      userPublicUrl: 'https://hooks.example.com/',
    });
    expect(status).toMatchObject({ configured: true, source: 'user', publicUrl: 'https://hooks.example.com' });
    expect(startTunnel).not.toHaveBeenCalled();
  });

  it('rejects a user-supplied local-only url for twilio', async () => {
    const status = await resolveExposure({
      platform: 'sms-twilio',
      webhookPort: 25808,
      tunnelEnabled: false,
      userPublicUrl: 'https://127.0.0.1:25808',
    });
    expect(status.configured).toBe(false);
    expect(status.source).toBe('user');
  });

  it('starts a cloudflared tunnel when opt-in is on and no user url is set', async () => {
    startTunnel.mockResolvedValue({
      provider: 'cloudflared',
      publicUrl: 'https://abc.trycloudflare.com',
      stop: vi.fn(async () => undefined),
    });
    const status = await resolveExposure({
      platform: 'sms-twilio',
      webhookPort: 25808,
      tunnelEnabled: true,
    });
    expect(startTunnel).toHaveBeenCalledWith({ port: 25808, provider: undefined });
    expect(status).toMatchObject({ configured: true, source: 'tunnel', publicUrl: 'https://abc.trycloudflare.com' });
  });

  it('reuses a single tunnel across concurrent callers for the same port', async () => {
    startTunnel.mockResolvedValue({
      provider: 'cloudflared',
      publicUrl: 'https://abc.trycloudflare.com',
      stop: vi.fn(async () => undefined),
    });
    const [a, b] = await Promise.all([
      resolveExposure({ platform: 'sms-twilio', webhookPort: 25808, tunnelEnabled: true }),
      resolveExposure({ platform: 'sms-twilio', webhookPort: 25808, tunnelEnabled: true }),
    ]);
    expect(a.publicUrl).toBe('https://abc.trycloudflare.com');
    expect(b.publicUrl).toBe('https://abc.trycloudflare.com');
    expect(startTunnel).toHaveBeenCalledTimes(1);
  });

  it('surfaces a tunnel start failure as not-configured (no throw)', async () => {
    startTunnel.mockRejectedValue(new Error('cloudflared missing'));
    const status = await resolveExposure({ platform: 'sms-twilio', webhookPort: 25808, tunnelEnabled: true });
    expect(status.configured).toBe(false);
    expect(status.source).toBe('tunnel');
    expect(status.message).toContain('cloudflared missing');
  });

  it('returns an actionable not-configured status when twilio has no url and opt-in is off', async () => {
    const status = await resolveExposure({ platform: 'sms-twilio', webhookPort: 25808, tunnelEnabled: false });
    expect(status).toMatchObject({ configured: false, source: 'none', publicUrl: null });
    expect(status.message).toMatch(/public|tunnel/i);
    expect(startTunnel).not.toHaveBeenCalled();
  });
});

describe('buildWebhookUrl', () => {
  it('composes the route the receiver mounts', () => {
    expect(buildWebhookUrl('https://abc.trycloudflare.com', 'sms-twilio', 'tok123')).toBe(
      'https://abc.trycloudflare.com/webhooks/sms-twilio/tok123'
    );
  });

  it('trims a trailing slash on the base', () => {
    expect(buildWebhookUrl('https://abc.trycloudflare.com/', 'sms-twilio', 'tok')).toBe(
      'https://abc.trycloudflare.com/webhooks/sms-twilio/tok'
    );
  });
});
