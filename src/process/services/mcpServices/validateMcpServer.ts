/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer } from '@/common/config/storage';

/**
 * MCP server names that are interpolated into per-CLI agent commands must be a
 * conservative identifier so they can never break out of an argv element or be
 * abused by a CLI that re-parses the name.
 */
const SAFE_MCP_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Validate an MCP server before it is synced to any per-CLI agent.
 *
 * This is the single pre-sync guard for the command-injection surface
 * (SEC-MCP-01): even though every agent now uses argv arrays (`shell:false`),
 * a malformed name or non-http(s) URL is rejected up front as defense in depth
 * and to keep CLI behaviour predictable across Claude/Gemini/Qwen/Codex/etc.
 *
 * @param server The MCP server to validate.
 * @throws {Error} If the name is not a safe identifier or a remote transport URL is not http(s).
 */
export function validateMcpServer(server: IMcpServer): void {
  if (!SAFE_MCP_NAME.test(server.name)) {
    throw new Error(`Invalid MCP server name "${server.name}": only letters, digits, '_', '.', and '-' are allowed`);
  }

  const { transport } = server;
  if (transport.type === 'sse' || transport.type === 'http' || transport.type === 'streamable_http') {
    let parsed: URL;
    try {
      parsed = new URL(transport.url);
    } catch {
      throw new Error(`Invalid MCP server URL for "${server.name}": ${transport.url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Invalid MCP server URL for "${server.name}": only http(s) URLs are allowed, got ${parsed.protocol}`
      );
    }
  }
}
