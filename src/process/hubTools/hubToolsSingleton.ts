/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Singleton accessor for HubToolsMcpServer. `initHubToolsService` is called
 * once on app boot (initBridge, after CostAnalyticsService exists); managers
 * read the stdio config via `getHubToolsStdioConfig()` when building a
 * session's MCP servers.
 */

import type { CostAnalyticsService } from '@process/services/cost/CostAnalyticsService';
import type { StdioMcpConfig } from '@process/team/mcp/team/TeamMcpServer';
import { HubToolsMcpServer } from './HubToolsMcpServer';

let _service: HubToolsMcpServer | null = null;
let _stdioConfig: StdioMcpConfig | null = null;

export async function initHubToolsService(costAnalytics: CostAnalyticsService): Promise<void> {
  if (_service) return;
  _service = new HubToolsMcpServer(costAnalytics);
  _stdioConfig = await _service.start();
}

export function getHubToolsStdioConfig(): StdioMcpConfig | null {
  return _stdioConfig;
}

export async function stopHubToolsService(): Promise<void> {
  await _service?.stop();
  _service = null;
  _stdioConfig = null;
}
