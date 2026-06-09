/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { __test } from '@process/channels/tunnel/cloudflaredBinary';

const { resolveAssetSpec, RELEASE_BASE } = __test;

describe('resolveAssetSpec', () => {
  it('maps macOS arm64/x64 to extractable tarballs', () => {
    expect(resolveAssetSpec('darwin', 'arm64')).toEqual({
      asset: 'cloudflared-darwin-arm64.tgz',
      archive: true,
      binName: 'cloudflared',
    });
    expect(resolveAssetSpec('darwin', 'x64')).toEqual({
      asset: 'cloudflared-darwin-amd64.tgz',
      archive: true,
      binName: 'cloudflared',
    });
  });

  it('maps linux x64/arm64 to raw binaries', () => {
    expect(resolveAssetSpec('linux', 'x64')).toEqual({
      asset: 'cloudflared-linux-amd64',
      archive: false,
      binName: 'cloudflared',
    });
    expect(resolveAssetSpec('linux', 'arm64')).toEqual({
      asset: 'cloudflared-linux-arm64',
      archive: false,
      binName: 'cloudflared',
    });
  });

  it('maps windows x64 to a raw .exe', () => {
    expect(resolveAssetSpec('win32', 'x64')).toEqual({
      asset: 'cloudflared-windows-amd64.exe',
      archive: false,
      binName: 'cloudflared.exe',
    });
  });

  it('returns null for unsupported platform/arch combos', () => {
    expect(resolveAssetSpec('darwin', 'ia32')).toBeNull();
    expect(resolveAssetSpec('win32', 'arm64')).toBeNull();
    expect(resolveAssetSpec('aix', 'x64')).toBeNull();
  });

  it('downloads from the official cloudflare latest-release host over https', () => {
    expect(RELEASE_BASE).toBe('https://github.com/cloudflare/cloudflared/releases/latest/download');
  });
});
