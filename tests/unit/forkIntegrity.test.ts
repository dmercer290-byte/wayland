import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Fork-integrity tripwire.
 *
 * This fork carries features on top of upstream (FerroxLabs/wayland) that
 * live in fork-owned files but are wired into upstream-owned files through
 * small hook lines. An upstream merge that resolves a conflict the wrong way
 * can silently drop a hook - the code still compiles, the feature just stops
 * running. These tests fail loudly instead.
 *
 * If a test here fails after an upstream merge: re-apply the missing hook
 * (see docs/contributing/fork-maintenance.md for what each hook does).
 * If it fails because you intentionally refactored a hook: update the
 * manifest below AND the inventory in fork-maintenance.md in the same commit.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Files that exist only in this fork. Upstream merges must never delete them. */
const FORK_OWNED_FILES = [
  // Transcript logging (full-detail conversation mirror into IJFW memory)
  'src/process/services/memory/transcriptFormat.ts',
  'src/process/services/memory/transcriptLogger.ts',
  // Hub tools MCP server (Model Hub VRAM swap + cost report as agent tools)
  'src/process/hubTools/HubToolsMcpServer.ts',
  'src/process/hubTools/hubToolsFormat.ts',
  'src/process/hubTools/hubToolsMcpStdio.ts',
  'src/process/hubTools/hubToolsSingleton.ts',
  // Model Hub (local inference server management)
  'src/process/services/modelHub/modelHubService.ts',
  'src/process/bridge/modelHubBridge.ts',
  'src/renderer/pages/settings/ModelsSettings/components/ModelHubPanel.tsx',
  // Cron rate-limit fallback
  'src/process/services/cron/rateLimitClassifier.ts',
  'src/renderer/pages/settings/GeneralSettings/RateLimitFallbackSelector.tsx',
  // Context-compaction preset
  'src/renderer/pages/settings/GeneralSettings/ContextModeSelector.tsx',
  // Cost analytics extensions
  'src/renderer/pages/conversation/components/ConversationCostBadge.tsx',
  'src/renderer/pages/mission-control/cost/UsageCalendar.tsx',
];

type ForkHook = {
  /** Upstream-owned file that carries the hook. */
  file: string;
  /** Which fork feature dies if the hook is lost. */
  feature: string;
  /** Substrings that must all be present in the file. */
  mustContain: string[];
};

/** Hook lines the fork adds inside upstream-owned files. */
const FORK_HOOKS: ForkHook[] = [
  {
    file: 'src/process/utils/message.ts',
    feature: 'transcript logging - every chat/tool/thinking message is mirrored here',
    mustContain: ['recordTranscriptMessage(this.conversation_id, message)'],
  },
  {
    file: 'src/process/bridge/memoryArchiveBridge.ts',
    feature: 'transcript logging on/off toggle (IPC providers + cache invalidation)',
    mustContain: [
      'invalidateTranscriptLoggingCache',
      'ipcBridge.memory.getTranscriptLogging.provider',
      'ipcBridge.memory.setTranscriptLogging.provider',
    ],
  },
  {
    file: 'src/common/adapter/ipcBridge.ts',
    feature: 'IPC surface for transcript toggle + Model Hub',
    mustContain: ['getTranscriptLogging', 'setTranscriptLogging', 'export const modelHub'],
  },
  {
    file: 'src/common/config/storage.ts',
    feature: 'fork settings keys (dropping one orphans its Settings UI)',
    mustContain: [
      "'memory.transcriptLogging'?",
      "'wcore.compactMode'?",
      "'modelHub.servers'?",
      "'rateLimit.fallbackModel'?",
    ],
  },
  {
    file: 'src/process/bridge/index.ts',
    feature: 'Model Hub bridge registration',
    mustContain: ['initModelHubBridge()'],
  },
  {
    file: 'src/process/utils/initBridge.ts',
    feature: 'hub-tools MCP server cold-start',
    mustContain: ['initHubToolsService'],
  },
  {
    file: 'src/process/task/WCoreManager.ts',
    feature: 'hub-tools MCP injection into every desktop wcore session',
    mustContain: ['hubToolsSingleton'],
  },
  {
    file: 'scripts/build-mcp-servers.js',
    feature: 'hub-tools stdio server build entry',
    mustContain: ['hubToolsMcpStdio'],
  },
  {
    file: 'src/process/agent/wcore/index.ts',
    feature: 'context-compaction preset read from Settings at spawn',
    mustContain: ["ProcessConfig.get('wcore.compactMode')"],
  },
  {
    file: 'src/process/agent/wcore/envBuilder.ts',
    feature: 'context-compaction preset injected into engine config',
    mustContain: ['buildCompactSection'],
  },
  {
    file: 'src/process/services/cron/CronService.ts',
    feature: 'rate-limit classification + fallback model for cron runs',
    mustContain: ['classifyRunError', "ProcessConfig.get('rateLimit.fallbackModel')"],
  },
  {
    file: 'src/process/bridge/costBridge.ts',
    feature: 'per-model cost series IPC (feeds UsageCalendar)',
    mustContain: ['seriesByModel'],
  },
  {
    file: 'src/renderer/pages/conversation/components/ChatConversation.tsx',
    feature: 'per-conversation cost badge',
    mustContain: ['<ConversationCostBadge'],
  },
  {
    file: 'src/renderer/pages/mission-control/cost/CostTab.tsx',
    feature: 'usage calendar in Mission Control cost tab',
    mustContain: ['<UsageCalendar'],
  },
  {
    file: 'src/renderer/pages/settings/GeneralSettings/index.tsx',
    feature: 'compaction + rate-limit fallback settings UI',
    mustContain: ['<ContextModeSelector', '<RateLimitFallbackSelector'],
  },
  {
    file: 'src/renderer/pages/settings/ModelsSettings/index.tsx',
    feature: 'Model Hub panel in model settings',
    mustContain: ['<ModelHubPanel'],
  },
  {
    file: 'src/renderer/pages/settings/IjfwSettingsPanel.tsx',
    feature: 'transcript-logging toggle in IJFW settings',
    mustContain: ['setTranscriptLogging'],
  },
];

describe('fork integrity (see docs/contributing/fork-maintenance.md)', () => {
  it.each(FORK_OWNED_FILES)('fork-owned file survives upstream merges: %s', (file) => {
    expect(
      existsSync(path.join(REPO_ROOT, file)),
      `${file} was deleted - an upstream merge probably resolved against the fork side`
    ).toBe(true);
  });

  it.each(FORK_HOOKS.map((hook) => [hook.file, hook] as const))('fork hook intact in %s', (_file, hook) => {
    const fullPath = path.join(REPO_ROOT, hook.file);
    expect(existsSync(fullPath), `${hook.file} is missing entirely`).toBe(true);
    const content = readFileSync(fullPath, 'utf-8');
    for (const needle of hook.mustContain) {
      expect(
        content.includes(needle),
        `Fork hook lost in ${hook.file}: expected to find \`${needle}\`.\n` +
          `This wires up: ${hook.feature}.\n` +
          `An upstream merge likely dropped it - re-apply the hook, or if this was an ` +
          `intentional refactor, update FORK_HOOKS and docs/contributing/fork-maintenance.md.`
      ).toBe(true);
    }
  });
});
