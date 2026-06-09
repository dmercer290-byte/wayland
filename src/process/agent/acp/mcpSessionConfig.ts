/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer } from '@/common/config/storage';
import type { AcpMcpCapabilities } from '@/common/types/acpTypes';

export interface AcpSessionMcpNameValue {
  name: string;
  value: string;
}

export interface AcpSessionMcpServerStdio {
  type?: 'stdio';
  name: string;
  command: string;
  args: string[];
  env: AcpSessionMcpNameValue[];
}

export interface AcpSessionMcpServerHttpLike {
  type: 'http' | 'sse';
  name: string;
  url: string;
  headers?: AcpSessionMcpNameValue[];
}

export type AcpSessionMcpServer = AcpSessionMcpServerStdio | AcpSessionMcpServerHttpLike;

function toNameValueEntries(source?: Record<string, string>): AcpSessionMcpNameValue[] | undefined {
  if (!source) return undefined;
  const entries = Object.entries(source)
    .filter(([name, value]) => typeof name === 'string' && typeof value === 'string')
    .map(([name, value]) => ({ name, value }));
  return entries.length > 0 ? entries : undefined;
}

function shouldInjectBuiltinServer(server: IMcpServer): boolean {
  if (server.builtin !== true || !server.enabled) {
    return false;
  }

  return server.status === undefined || server.status === 'connected';
}

/**
 * Whether an MCP server should be injected into the fork Gemini runtime
 * (@office-ai/aioncli-core via GeminiAgentManager).
 *
 * Builtin servers (image generation, skill search) are seeded into mcp.config
 * with `status: undefined` and are never connection-tested, so they must be
 * accepted on `undefined` exactly like the ACP session path
 * (`shouldInjectBuiltinServer`); otherwise the fork Gemini backend silently
 * drops them while ACP backends (Claude, Codex, Wayland Core) inject them.
 * User-added servers still require an active `connected` status.
 */
export function shouldInjectGeminiMcpServer(server: IMcpServer): boolean {
  if (!server.enabled) {
    return false;
  }
  if (server.builtin === true) {
    return server.status === undefined || server.status === 'connected';
  }
  return server.status === 'connected';
}

export function buildBuiltinAcpSessionMcpServers(
  mcpServers: IMcpServer[] | undefined | null,
  capabilities: AcpMcpCapabilities
): AcpSessionMcpServer[] {
  if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
    return [];
  }

  return mcpServers
    .filter(shouldInjectBuiltinServer)
    .map((server): AcpSessionMcpServer | null => {
      switch (server.transport.type) {
        case 'stdio':
          if (!capabilities.stdio) return null;
          return {
            type: 'stdio',
            name: server.name,
            command: server.transport.command,
            args: server.transport.args || [],
            env: toNameValueEntries(server.transport.env) ?? [],
          };
        case 'http':
        case 'streamable_http':
          if (!capabilities.http) return null;
          return {
            type: 'http',
            name: server.name,
            url: server.transport.url,
            headers: toNameValueEntries(server.transport.headers),
          };
        case 'sse':
          if (!capabilities.sse) return null;
          return {
            type: 'sse',
            name: server.name,
            url: server.transport.url,
            headers: toNameValueEntries(server.transport.headers),
          };
        default:
          return null;
      }
    })
    .filter((server): server is AcpSessionMcpServer => server !== null);
}

/** Config shape passed from TeamSessionService to AgentManagers */
export type TeamMcpStdioConfig = {
  name: string;
  command: string;
  args: string[];
  env: AcpSessionMcpNameValue[];
};

/**
 * Build the AcpSessionMcpServer entry for a team MCP stdio server.
 * Returns null if the config is missing or has no command - callers should
 * simply skip injection in that case.
 */
export function buildTeamMcpServer(config: TeamMcpStdioConfig | undefined | null): AcpSessionMcpServerStdio | null {
  if (!config || !config.command) return null;
  return {
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
  };
}
