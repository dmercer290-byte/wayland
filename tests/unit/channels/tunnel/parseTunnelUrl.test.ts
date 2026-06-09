/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseCloudflaredUrl, parseNgrokJsonLine } from '@process/channels/tunnel/parseTunnelUrl';

describe('parseCloudflaredUrl', () => {
  it('extracts the trycloudflare URL from the boxed banner', () => {
    const banner = [
      '2026-06-08T00:00:00Z INF +--------------------------------------------------+',
      '2026-06-08T00:00:00Z INF |  Your quick Tunnel has been created! Visit it at  |',
      '2026-06-08T00:00:00Z INF |  https://red-fox-helpful-tree.trycloudflare.com   |',
      '2026-06-08T00:00:00Z INF +--------------------------------------------------+',
    ].join('\n');
    expect(parseCloudflaredUrl(banner)).toBe('https://red-fox-helpful-tree.trycloudflare.com');
  });

  it('matches a URL inline in a single log line', () => {
    const line = 'INF Registered tunnel connection at https://abc-123-def.trycloudflare.com conn=0';
    expect(parseCloudflaredUrl(line)).toBe('https://abc-123-def.trycloudflare.com');
  });

  it('returns null when no URL is present (still buffering)', () => {
    expect(parseCloudflaredUrl('INF Starting tunnel...')).toBeNull();
    expect(parseCloudflaredUrl('')).toBeNull();
  });

  it('does not match a non-cloudflare https URL', () => {
    expect(parseCloudflaredUrl('visit https://example.com now')).toBeNull();
  });
});

describe('parseNgrokJsonLine', () => {
  it('extracts the url from a "started tunnel" json line', () => {
    const line = JSON.stringify({
      lvl: 'info',
      msg: 'started tunnel',
      url: 'https://abc123.ngrok-free.app',
      addr: 'http://localhost:25808',
    });
    expect(parseNgrokJsonLine(line)).toBe('https://abc123.ngrok-free.app');
  });

  it('accepts a json line carrying url + addr without the started-tunnel msg', () => {
    const line = JSON.stringify({ lvl: 'info', url: 'https://xyz.ngrok.io', addr: 'http://localhost:25808' });
    expect(parseNgrokJsonLine(line)).toBe('https://xyz.ngrok.io');
  });

  it('ignores non-https urls', () => {
    const line = JSON.stringify({ msg: 'started tunnel', url: 'http://insecure.example' });
    expect(parseNgrokJsonLine(line)).toBeNull();
  });

  it('returns null for non-json banner text', () => {
    expect(parseNgrokJsonLine('ngrok by @inconshreveable')).toBeNull();
    expect(parseNgrokJsonLine('')).toBeNull();
  });

  it('returns null for json without a public url', () => {
    expect(parseNgrokJsonLine(JSON.stringify({ msg: 'starting web service', addr: '127.0.0.1:4040' }))).toBeNull();
  });
});
