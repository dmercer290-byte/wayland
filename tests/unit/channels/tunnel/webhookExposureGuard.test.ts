/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  assertPublicWebhookUrl,
  isLocalOnlyWebhookHost,
  isProviderUnreachableWebhookUrl,
  providerRequiresPublicWebhook,
} from '@process/channels/tunnel/webhookExposureGuard';

describe('providerRequiresPublicWebhook', () => {
  it('is true for twilio sms and friends', () => {
    expect(providerRequiresPublicWebhook('sms-twilio')).toBe(true);
    expect(providerRequiresPublicWebhook('twilio')).toBe(true);
    expect(providerRequiresPublicWebhook('telnyx')).toBe(true);
  });

  it('is false for unknown/local-only platforms and undefined', () => {
    expect(providerRequiresPublicWebhook('telegram')).toBe(false);
    expect(providerRequiresPublicWebhook(undefined)).toBe(false);
  });
});

describe('isLocalOnlyWebhookHost', () => {
  it('flags loopback and private ranges', () => {
    expect(isLocalOnlyWebhookHost('127.0.0.1')).toBe(true);
    expect(isLocalOnlyWebhookHost('localhost')).toBe(true);
    expect(isLocalOnlyWebhookHost('10.0.0.5')).toBe(true);
    expect(isLocalOnlyWebhookHost('192.168.1.20')).toBe(true);
    expect(isLocalOnlyWebhookHost('172.16.0.1')).toBe(true);
    expect(isLocalOnlyWebhookHost('169.254.1.1')).toBe(true);
    expect(isLocalOnlyWebhookHost('100.64.0.1')).toBe(true);
    expect(isLocalOnlyWebhookHost('::1')).toBe(true);
    expect(isLocalOnlyWebhookHost('fe80::1')).toBe(true);
    expect(isLocalOnlyWebhookHost('fc00::1')).toBe(true);
  });

  it('flags .local / .internal / single-label hosts', () => {
    expect(isLocalOnlyWebhookHost('myhost.local')).toBe(true);
    expect(isLocalOnlyWebhookHost('svc.internal')).toBe(true);
    expect(isLocalOnlyWebhookHost('mybox')).toBe(true);
  });

  it('passes a real public hostname', () => {
    expect(isLocalOnlyWebhookHost('red-fox.trycloudflare.com')).toBe(false);
    expect(isLocalOnlyWebhookHost('example.com')).toBe(false);
    expect(isLocalOnlyWebhookHost('8.8.8.8')).toBe(false);
  });
});

describe('isProviderUnreachableWebhookUrl', () => {
  it('flags loopback https and any http url', () => {
    expect(isProviderUnreachableWebhookUrl('https://127.0.0.1:25808/webhooks/sms-twilio/tok')).toBe(true);
    expect(isProviderUnreachableWebhookUrl('http://example.com/hook')).toBe(true);
    expect(isProviderUnreachableWebhookUrl('not a url')).toBe(true);
  });

  it('passes a real public https url', () => {
    expect(isProviderUnreachableWebhookUrl('https://abc.trycloudflare.com/webhooks/sms-twilio/tok')).toBe(false);
  });
});

describe('assertPublicWebhookUrl', () => {
  it('throws for twilio on a loopback url', () => {
    expect(() => assertPublicWebhookUrl('sms-twilio', 'https://127.0.0.1:25808/webhooks/sms-twilio/t')).toThrow(
      /publicly reachable/
    );
  });

  it('does not throw for twilio on a public https url', () => {
    expect(() =>
      assertPublicWebhookUrl('sms-twilio', 'https://abc.trycloudflare.com/webhooks/sms-twilio/t')
    ).not.toThrow();
  });

  it('is a no-op for platforms that do not require a public url', () => {
    expect(() => assertPublicWebhookUrl('telegram', 'https://127.0.0.1/whatever')).not.toThrow();
  });
});
