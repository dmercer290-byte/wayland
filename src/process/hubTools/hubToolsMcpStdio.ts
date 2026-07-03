/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standalone stdio MCP server for the Model Hub + cost tools.
 *
 * Spawned by the agent CLI as a stdio MCP server; forwards each tool call to
 * the main-process HubToolsMcpServer over TCP (AION_MCP_PORT), matching the
 * team-guide bridge's transport (4-byte big-endian length header + JSON).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { sendTcpRequest } from '@process/team/mcp/tcpHelpers';

const AION_MCP_TOKEN = process.env.AION_MCP_TOKEN || undefined;
const AION_MCP_PORT = parseInt(process.env.AION_MCP_PORT || '0', 10);

if (!AION_MCP_PORT || !AION_MCP_TOKEN) {
  process.stderr.write('[hub-tools-mcp-stdio] AION_MCP_PORT and AION_MCP_TOKEN are required\n');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createHubTool(server: McpServer, toolName: string, description: string, schema: any): void {
  server.tool(toolName, description, schema, async (args: Record<string, unknown>) => {
    try {
      const response = await sendTcpRequest(AION_MCP_PORT, {
        tool: toolName,
        args,
        auth_token: AION_MCP_TOKEN,
      });
      if (response.error) {
        return { content: [{ type: 'text' as const, text: `Error: ${response.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: response.result || '' }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  });
}

const server = new McpServer({ name: 'wayland-hub-tools', version: '1.0.0' }, { capabilities: { tools: {} } });

createHubTool(
  server,
  'hub_list_models',
  `List every model on the user's registered model servers (Ollama, LM Studio, vLLM, ...), including which model is currently loaded in each server's VRAM and which servers are offline.

Use this before hub_load_model to see exact server and model names, or whenever the user asks what local models they have.`,
  {}
);

createHubTool(
  server,
  'hub_load_model',
  `Load a model into VRAM on one of the user's Ollama servers. Any OTHER model resident on that server is unloaded first (freeing its VRAM), then the requested model is warmed so it responds instantly.

Only Ollama servers support this; OpenAI-compatible servers (LM Studio, vLLM) are list-only. Use hub_list_models first to get exact names.`,
  {
    server: z
      .string()
      .optional()
      .describe(
        'Server name, id, or URL fragment (from hub_list_models). May be omitted when only one server is registered.'
      ),
    model: z.string().min(1).describe('Exact model name to load, e.g. "qwen3:8b" or "llama3:70b".'),
  }
);

createHubTool(
  server,
  'cost_report',
  `Report the user's real API spend from the app's cost ledger: total dollars, tokens, and turn count for the period, plus a per-model breakdown (top 10 by cost).

Use when the user asks what they have spent, which model is costing the most, or for budgeting decisions.`,
  {
    period: z
      .enum(['today', 'week', 'month'])
      .optional()
      .describe("Reporting window: 'today', 'week' (last 7 days, default), or 'month' (last 30 days)."),
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`[hub-tools-mcp-stdio] Fatal error: ${err}\n`);
  process.exit(1);
});
