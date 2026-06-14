/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { classifyClientTrust, isPrivateNetworkIp } from '../../src/process/webserver/middleware/networkTrust';

describe('networkTrust - private-network classification (#83)', () => {
  it('treats loopback (v4 + v6 + mapped) as operator', () => {
    expect(classifyClientTrust('127.0.0.1')).toBe('operator');
    expect(classifyClientTrust('127.5.5.5')).toBe('operator');
    expect(classifyClientTrust('::1')).toBe('operator');
    expect(classifyClientTrust('::ffff:127.0.0.1')).toBe('operator');
  });

  it('treats RFC1918 LAN ranges as operator', () => {
    expect(classifyClientTrust('10.0.0.4')).toBe('operator');
    expect(classifyClientTrust('192.168.1.50')).toBe('operator');
    expect(classifyClientTrust('172.16.0.1')).toBe('operator');
    expect(classifyClientTrust('172.31.255.254')).toBe('operator');
    // 172.32 is OUTSIDE the /12 - public.
    expect(classifyClientTrust('172.32.0.1')).toBe('restricted');
    expect(classifyClientTrust('172.15.0.1')).toBe('restricted');
  });

  it('treats the Tailscale CGNAT range (100.64.0.0/10) as operator', () => {
    expect(classifyClientTrust('100.105.198.32')).toBe('operator'); // the DGX reporter's tailnet IP
    expect(classifyClientTrust('100.64.0.0')).toBe('operator');
    expect(classifyClientTrust('100.127.255.255')).toBe('operator');
    // 100.128 is OUTSIDE the /10 - public. 100.63 is below it - public.
    expect(classifyClientTrust('100.128.0.1')).toBe('restricted');
    expect(classifyClientTrust('100.63.0.1')).toBe('restricted');
  });

  it('treats link-local + IPv6 unique-local as operator', () => {
    expect(classifyClientTrust('169.254.1.1')).toBe('operator');
    expect(classifyClientTrust('fe80::1')).toBe('operator');
    expect(classifyClientTrust('fd00::1')).toBe('operator');
    expect(classifyClientTrust('fc00::1')).toBe('operator');
  });

  it('treats public IPs as restricted', () => {
    expect(classifyClientTrust('8.8.8.8')).toBe('restricted');
    expect(classifyClientTrust('1.1.1.1')).toBe('restricted');
    expect(classifyClientTrust('203.0.113.7')).toBe('restricted');
    expect(classifyClientTrust('2606:4700:4700::1111')).toBe('restricted');
  });

  it('fails safe to restricted on missing/garbage input', () => {
    expect(classifyClientTrust(undefined)).toBe('restricted');
    expect(classifyClientTrust(null)).toBe('restricted');
    expect(classifyClientTrust('')).toBe('restricted');
    expect(classifyClientTrust('not-an-ip')).toBe('restricted');
    expect(classifyClientTrust('999.999.999.999')).toBe('restricted');
    expect(classifyClientTrust('10.0.0')).toBe('restricted');
  });

  it('isPrivateNetworkIp matches the classifier', () => {
    expect(isPrivateNetworkIp('100.105.198.32')).toBe(true);
    expect(isPrivateNetworkIp('8.8.8.8')).toBe(false);
  });
});
