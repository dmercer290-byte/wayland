/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure formatting for the hub-tools MCP responses (no electron/db imports so
 * it stays unit-testable). HubToolsMcpServer owns the side-effect path.
 */

import type { HubModel, HubServerStatus, LoadResult } from '@process/services/modelHub/modelHubService';
import type { CostAggregate, CostSummary } from '@process/services/cost/types';

const formatSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? ` (${gb.toFixed(1)} GB)` : ` (${(bytes / 1024 ** 2).toFixed(0)} MB)`;
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

const formatUsd = (v: number): string => (v >= 0.01 || v === 0 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`);

/** `hub_list_models` response: servers with status, then models grouped per server. */
export function formatHubList(servers: HubServerStatus[], models: HubModel[]): string {
  if (servers.length === 0) {
    return 'No model servers registered. Add one in Settings → Models → Model Hub.';
  }
  const lines: string[] = [];
  for (const server of servers) {
    const status = server.online ? 'online' : `OFFLINE${server.error ? ` (${server.error})` : ''}`;
    lines.push(`## ${server.name} — ${server.kind} — ${status}`);
    const own = models.filter((m) => m.serverId === server.id);
    if (own.length === 0) {
      lines.push(server.online ? '  (no models)' : '  (unreachable)');
    }
    for (const m of own) {
      const badges = [m.loaded ? 'IN VRAM' : '', m.supportsSwap ? '' : 'no swap'].filter(Boolean);
      lines.push(`  - ${m.name}${formatSize(m.sizeBytes)}${badges.length ? ` [${badges.join(', ')}]` : ''}`);
    }
    lines.push('');
  }
  lines.push(
    'To make a model resident, call hub_load_model with the server name and model name (Ollama servers only).'
  );
  return lines.join('\n').trim();
}

/** `hub_load_model` response. */
export function formatLoadResult(result: LoadResult, serverName: string): string {
  if ('error' in result) {
    if (result.error === 'swap_unsupported') {
      return `Cannot swap on "${serverName}": only Ollama servers support load/unload. This server is OpenAI-compatible (display-only).`;
    }
    if (result.error === 'server_not_found') {
      return 'Server not found. Call hub_list_models to see registered servers.';
    }
    return `Load failed: ${result.error}`;
  }
  const freed = result.unloaded.length > 0 ? ` Freed VRAM by unloading: ${result.unloaded.join(', ')}.` : '';
  return `Loaded ${result.loaded} into VRAM on "${serverName}".${freed} The model is warm and ready.`;
}

/** `cost_report` response: window totals + top models. */
export function formatCostReport(periodLabel: string, summary: CostSummary, byModel: CostAggregate[]): string {
  if (summary.events === 0) {
    return `No recorded API usage ${periodLabel}.`;
  }
  const lines = [
    `# Spend ${periodLabel}`,
    `Total: ${formatUsd(summary.costUsd)} · ${formatTokens(summary.tokensTotal)} tokens · ${summary.events} turns`,
    '',
    '## By model',
  ];
  for (const row of byModel.slice(0, 10)) {
    lines.push(`- ${row.key || '(unattributed)'}: ${formatUsd(row.costUsd)} · ${formatTokens(row.tokensTotal)} tokens`);
  }
  return lines.join('\n');
}

/** Resolve a user-supplied server reference (name, id, or URL fragment). */
export function resolveServerRef(servers: HubServerStatus[], ref: string): HubServerStatus | undefined {
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    servers.find((s) => s.id === ref) ??
    servers.find((s) => s.name.toLowerCase() === needle) ??
    servers.find((s) => s.url.toLowerCase().includes(needle)) ??
    (servers.length === 1 ? servers[0] : undefined)
  );
}
