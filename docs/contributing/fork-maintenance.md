# Fork Maintenance

This repository is a fork of upstream **FerroxLabs/wayland** carrying a set of
custom features. This document is the single source of truth for **what the
fork owns** and **how to merge upstream without losing it**. It exists because
upstream merges have repeatedly threatened to silently drop fork wiring.

**Current upstream base: v0.11.17** (merged in `9417e0d`, bundles
wayland-core v0.12.24). Update this line on every upstream merge.

The engine fork (dmercer290-byte/wayland-core) has its own merge playbook in
its `REBRANDING.md` - the rules below cover only this desktop repo.

## Enforcement

`tests/unit/forkIntegrity.test.ts` is a tripwire that asserts every fork-owned
file still exists and every hook line listed below is still present. It runs
with the normal suite (`bun run test`), so CI fails if a merge drops fork
wiring. **Keep the test's manifest, this document, and the code in sync** - if
you intentionally refactor a hook, update all three in the same commit.

## Fork features and their wiring

Each feature lives in fork-owned files (safe in merges - upstream never edits
them) plus small **hooks inside upstream-owned files** (the at-risk part;
conflicts land here).

### Transcript logging (full-detail conversation mirror)

Mirrors every chat, tool call, and thinking block into
`.ijfw/memory/transcript.md` (secret-redacted, size-rotated). Covers regular
chat AND team sessions because everything funnels through one store.

- Fork-owned: `src/process/services/memory/transcriptLogger.ts`,
  `transcriptFormat.ts` (+ tests)
- Hooks: `src/process/utils/message.ts` (`recordTranscriptMessage(...)` in
  `ConversationManageWithDB.sync()` - **the load-bearing line**; every agent
  manager and `TeamSession`/`TeammateManager` route through this store),
  `src/process/bridge/memoryArchiveBridge.ts` (toggle IPC providers +
  `invalidateTranscriptLoggingCache`), `src/common/adapter/ipcBridge.ts`
  (`memory.get/set-transcript-logging`), `src/common/config/storage.ts`
  (`memory.transcriptLogging` key),
  `src/renderer/pages/settings/IjfwSettingsPanel.tsx` (toggle UI)

### Hub tools MCP server

Model Hub VRAM swap + cost report exposed as agent-callable tools in every
desktop-managed wcore session.

- Fork-owned: `src/process/hubTools/*`
- Hooks: `src/process/utils/initBridge.ts` (`initHubToolsService` at
  cold-start), `src/process/task/WCoreManager.ts` (stdio MCP injection),
  `scripts/build-mcp-servers.js` (build entry for `hubToolsMcpStdio.ts`)

### Model Hub (local inference servers)

- Fork-owned: `src/process/services/modelHub/modelHubService.ts`,
  `src/process/bridge/modelHubBridge.ts`,
  `src/renderer/pages/settings/ModelsSettings/components/ModelHubPanel.tsx`
- Hooks: `src/process/bridge/index.ts` (`initModelHubBridge()`),
  `src/common/adapter/ipcBridge.ts` (`modelHub` provider group),
  `src/common/config/storage.ts` (`modelHub.servers`),
  `src/renderer/pages/settings/ModelsSettings/index.tsx` (`<ModelHubPanel />`)

### Context-compaction preset

Settings-selectable economy/light/max compaction injected into the engine
config at spawn.

- Fork-owned: `.../GeneralSettings/ContextModeSelector.tsx`
- Hooks: `src/process/agent/wcore/index.ts` (reads `wcore.compactMode`),
  `src/process/agent/wcore/envBuilder.ts` (`buildCompactSection`),
  `src/common/config/storage.ts` (`wcore.compactMode`),
  `.../GeneralSettings/index.tsx` (`<ContextModeSelector />`)

### Cron rate-limit fallback

Classifies cron run failures and retries on a configured fallback model.

- Fork-owned: `src/process/services/cron/rateLimitClassifier.ts` (+ test),
  `.../GeneralSettings/RateLimitFallbackSelector.tsx`
- Hooks: `src/process/services/cron/CronService.ts` (`classifyRunError` +
  `rateLimit.fallbackModel` read), `src/common/config/storage.ts`
  (`rateLimit.fallbackModel`), `.../GeneralSettings/index.tsx`
  (`<RateLimitFallbackSelector />`)

### Cost analytics extensions

Per-conversation cost badge and per-model usage calendar.

- Fork-owned: `.../conversation/components/ConversationCostBadge.tsx`,
  `.../mission-control/cost/UsageCalendar.tsx`
- Hooks: `src/process/bridge/costBridge.ts` + cost service files
  (`seriesByModel`), `.../ChatConversation.tsx` (`<ConversationCostBadge />`),
  `.../cost/CostTab.tsx` (`<UsageCalendar />`)

### i18n

The fork adds keys to `conversation`, `cron`, `memory`, `missionControl`, and
`settings` modules across all locales. Locale JSON merges should be resolved
as a **union** (keep both sides' keys). `bun run i18n:types` +
`node scripts/check-i18n.js` + typecheck catch dropped keys.

## Upstream merge playbook

Use the `upstream-merge` skill (`.claude/skills/upstream-merge/SKILL.md`) or
follow by hand:

1. `git remote add upstream https://github.com/FerroxLabs/wayland` (once),
   then `git fetch upstream --tags` and merge the **release tag**, not
   upstream main.
2. Resolve conflicts with this document open:
   - Fork-owned files: keep ours (upstream should never touch them; if it
     suddenly does, upstream may have shipped its own version of the feature -
     compare before choosing).
   - Hook files: take upstream's new content **and re-apply the hook lines**.
     Hooks are deliberately tiny (1-5 lines + an import) to make this easy.
   - Locale JSON / `i18n-keys.d.ts`: union merge, then regenerate types.
3. Verify, in order:
   - `bun run test tests/unit/forkIntegrity.test.ts` - fork wiring intact
   - `bun run test tests/unit/process/services/memory/` - memory/transcript suite
   - `bun run typecheck && bun run test` - full check
   - `bun run i18n:types && node scripts/check-i18n.js` if locales changed
4. Update the "Current upstream base" line at the top of this file.
5. If upstream shipped its own equivalent of a fork feature, prefer retiring
   the fork version: delete the fork files, remove the hooks, and prune the
   corresponding entries from `forkIntegrity.test.ts` and this document.

## Keeping the fork mergeable (rules for new fork work)

1. **New feature code goes in new files.** One directory or file per feature,
   never interleaved into upstream modules.
2. **Hooks stay tiny.** One import + one call/JSX element per hook site.
   If a hook grows past ~5 lines, extract the body into a fork-owned file and
   call it.
3. **Every new hook gets a tripwire.** Add the file/needle to
   `tests/unit/forkIntegrity.test.ts` and an entry here, in the same PR.
4. **Prefer upstream extension points** (existing registries, bridge init
   lists, settings keys) over editing upstream logic - a hook in a
   registration list merges clean; a hook inside a function body conflicts.
