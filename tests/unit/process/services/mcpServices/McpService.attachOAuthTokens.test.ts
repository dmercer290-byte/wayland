/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the OAuth service singleton so we control getValidToken.
const getValidToken = vi.fn();
vi.mock('@process/services/mcpServices/McpOAuthService', () => ({
  mcpOAuthService: { getValidToken: (...a: unknown[]) => getValidToken(...a) },
}));

import { McpService } from '@process/services/mcpServices/McpService';

// Reach the private chokepoint directly.
const attach = (svc: McpService, servers: unknown[]): Promise<unknown[]> =>
  (svc as unknown as { attachOAuthTokens: (s: unknown[]) => Promise<unknown[]> }).attachOAuthTokens(servers);

const httpServer = (name: string, headers?: Record<string, string>) => ({
  id: name,
  name,
  enabled: true,
  transport: { type: 'streamable_http', url: 'https://mcp.example.com', ...(headers ? { headers } : {}) },
});

describe('McpService.attachOAuthTokens (#MCP-oauth: reuse Wayland token, no engine re-OAuth)', () => {
  let svc: McpService;
  beforeEach(() => {
    getValidToken.mockReset();
    svc = new McpService();
  });

  it('attaches the stored bearer token to an authorized OAuth server', async () => {
    getValidToken.mockResolvedValue('tok-123');
    const [out] = (await attach(svc, [httpServer('canva')])) as Array<{ transport: { headers: Record<string, string> } }>;
    expect(out.transport.headers.Authorization).toBe('Bearer tok-123');
  });

  it('leaves a server unchanged when there is no stored token (non-OAuth)', async () => {
    getValidToken.mockResolvedValue(null);
    const input = httpServer('plain');
    const [out] = (await attach(svc, [input])) as Array<{ transport: { headers?: Record<string, string> } }>;
    expect(out.transport.headers).toBeUndefined();
  });

  it('does not overwrite an existing BYO Authorization header', async () => {
    getValidToken.mockResolvedValue('tok-should-not-be-used');
    const [out] = (await attach(svc, [httpServer('byo', { Authorization: 'Bearer byo-key' })])) as Array<{
      transport: { headers: Record<string, string> };
    }>;
    expect(out.transport.headers.Authorization).toBe('Bearer byo-key');
    expect(getValidToken).not.toHaveBeenCalled();
  });

  it('does not mutate the original server object', async () => {
    getValidToken.mockResolvedValue('tok-xyz');
    const input = httpServer('immut');
    await attach(svc, [input]);
    expect((input.transport as { headers?: unknown }).headers).toBeUndefined();
  });
});
