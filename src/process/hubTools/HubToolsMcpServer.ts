/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * HubToolsMcpServer - in-process MCP server exposing the Model Hub (list /
 * VRAM swap) and cost analytics (spend report) to agents as callable tools,
 * so "load qwen on the GPU box" or "what did I spend this week" work in chat.
 *
 * Runs a TCP server inside the Electron main process; a standalone stdio
 * bridge script (out/main/hub-tools-mcp-stdio.js) connects the agent CLI to
 * it - the same transport pattern as TeamMcpServer / TeamGuideMcpServer.
 */

import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as path from 'node:path';
import type { CostAnalyticsService } from '@process/services/cost/CostAnalyticsService';
import type { StdioMcpConfig } from '@process/team/mcp/team/TeamMcpServer';
import { createTcpMessageReader, resolveMcpScriptDir, writeTcpMessage } from '@process/team/mcp/tcpHelpers';
import { listAllModels, loadModel } from '@process/services/modelHub/modelHubService';
import { formatCostReport, formatHubList, formatLoadResult, resolveServerRef } from './hubToolsFormat';

const DAY_MS = 24 * 3_600_000;

type Period = 'today' | 'week' | 'month';

function windowFor(period: Period): { fromMs: number; toMs: number; label: string } {
  const now = Date.now();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  switch (period) {
    case 'today':
      return { fromMs: startOfDay.getTime(), toMs: now, label: 'today' };
    case 'week':
      return { fromMs: now - 7 * DAY_MS, toMs: now, label: 'in the last 7 days' };
    case 'month':
      return { fromMs: now - 30 * DAY_MS, toMs: now, label: 'in the last 30 days' };
  }
}

export class HubToolsMcpServer {
  private tcpServer: net.Server | null = null;
  private _port = 0;
  private readonly authToken = crypto.randomUUID();

  constructor(private readonly costAnalytics: CostAnalyticsService) {}

  /** Start the TCP server and return the stdio config for session injection. */
  async start(): Promise<StdioMcpConfig> {
    this.tcpServer = net.createServer((socket) => {
      this.handleTcpConnection(socket);
    });

    await new Promise<void>((resolve, reject) => {
      this.tcpServer!.listen(0, '127.0.0.1', () => {
        const addr = this.tcpServer!.address();
        if (addr && typeof addr === 'object') {
          this._port = addr.port;
        }
        resolve();
      });
      this.tcpServer!.once('error', reject);
    });

    console.log(`[HubToolsMcpServer] TCP server started on port ${this._port}`);
    return this.getStdioConfig();
  }

  async stop(): Promise<void> {
    if (this.tcpServer) {
      await new Promise<void>((resolve) => {
        this.tcpServer!.close(() => {
          this.tcpServer = null;
          resolve();
        });
      });
    }
    this._port = 0;
  }

  getStdioConfig(): StdioMcpConfig {
    const scriptPath = path.join(resolveMcpScriptDir(), 'hub-tools-mcp-stdio.js');
    return {
      name: 'wayland-hub-tools',
      command: 'node',
      args: [scriptPath],
      env: [
        { name: 'AION_MCP_PORT', value: String(this._port) },
        { name: 'AION_MCP_TOKEN', value: this.authToken },
      ],
    };
  }

  private handleTcpConnection(socket: net.Socket): void {
    const reader = createTcpMessageReader(
      async (msg) => {
        const request = msg as { tool?: string; args?: Record<string, unknown>; auth_token?: string };
        if (request.auth_token !== this.authToken) {
          writeTcpMessage(socket, { error: 'Unauthorized' });
          socket.end();
          return;
        }
        try {
          const result = await this.handleToolCall(request.tool ?? '', request.args ?? {});
          writeTcpMessage(socket, { result });
        } catch (err) {
          writeTcpMessage(socket, { error: err instanceof Error ? err.message : String(err) });
        }
        socket.end();
      },
      {
        onError: (err) => {
          console.warn(`[HubToolsMcpServer] TCP framing error: ${err.message}`);
          socket.destroy();
        },
      }
    );

    socket.on('data', reader);
    socket.on('error', () => {
      socket.destroy();
    });
    socket.setTimeout(600_000);
    socket.on('timeout', () => {
      socket.destroy();
    });
  }

  private async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case 'hub_list_models': {
        const { servers, models } = await listAllModels();
        return formatHubList(servers, models);
      }
      case 'hub_load_model': {
        const serverRef = String(args.server ?? '').trim();
        const model = String(args.model ?? '').trim();
        if (!model) throw new Error('model is required');
        const { servers } = await listAllModels();
        const server = resolveServerRef(servers, serverRef || model);
        if (!server) {
          throw new Error(
            `Server "${serverRef}" not found. Registered: ${servers.map((s) => s.name).join(', ') || '(none)'}`
          );
        }
        const result = await loadModel(server.id, model);
        return formatLoadResult(result, server.name);
      }
      case 'cost_report': {
        const raw = String(args.period ?? 'week');
        const period: Period = raw === 'today' || raw === 'month' ? raw : 'week';
        const { fromMs, toMs, label } = windowFor(period);
        const summary = this.costAnalytics.summary({ fromMs, toMs });
        const byModel = this.costAnalytics.byModel({ fromMs, toMs });
        return formatCostReport(label, summary, byModel);
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
