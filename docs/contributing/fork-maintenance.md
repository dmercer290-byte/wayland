# Fork Maintenance

This repository began as a fork of **FerroxLabs/wayland** and is now
**independent**: as of v0.11.17 we no longer track upstream. Upstream code
enters this repo only as a deliberate, reviewed cherry-pick - never as a
routine merge. This document is the single source of truth for **what the
fork owns**, **how we stay independent**, and how to import upstream code on
the rare occasion we choose to.

**Upstream divergence point: v0.11.17** (merged in `9417e0d`, bundles engine
v0.12.24). This is the last upstream code wholesale-imported into this repo.

**Monorepo:** the Rust engine now lives in THIS repo under `wayland-core/`
(git subtree, full history preserved). It keeps its own Rust CI and its
`REBRANDING.md` playbook under `wayland-core/`. The desktop's JS/TS tooling
(oxlint, prek) excludes the subtree. Engine releases are built from
`wayland-core/` by the root `.github/workflows/engine-release-self-hosted.yml`
and published to THIS repo's releases.

## Independence: nothing may point at upstream infrastructure

Installed apps and release builds must depend only on repos we control:

| Surface | File | Points at |
|---|---|---|
| Auto-update feed (electron-updater) | `electron-builder.yml` `publish:` | `dmercer290-byte/wayland` releases |
| App update metadata + integrity hashes | `src/process/bridge/updateBridge.ts` (`DEFAULT_REPO`) | `dmercer290-byte/wayland` |
| Bundled engine binaries (release build) | `scripts/prepareWaylandCore.js` (`GITHUB_REPO`) | `dmercer290-byte/wayland` releases (`genesis-core-*` archives on `v*-genesis-*` tags) |
| In-app engine updater (runtime) | `src/process/agent/wcore/wcoreUpdater.ts` (`REPO`) | `dmercer290-byte/wayland` |
| Headless installer engine fetch | `installer/scripts/postinstall.mjs` | `dmercer290-byte/wayland` |
| Engine pin/checksum bump tool | `scripts/stage-wcore-bump.mjs` (`REPO`) | `dmercer290-byte/wayland` |
| Engine build source | `.github/workflows/engine-release-self-hosted.yml` | builds from `wayland-core/` subtree, publishes to `dmercer290-byte/wayland` |
| Extension hub mirrors | `src/process/extensions/constants.ts`, `scripts/prepareHubResources.js` | `dmercer290-byte/waylandHub` (repo doesn't exist yet; fetches fail soft) |
| Engine self-update + provenance | `wayland-core/crates/wcore-cli/src/self_update.rs` | `dmercer290-byte/wayland-core` (engine CLI's own updater; separate from desktop) |

`tests/unit/forkIntegrity.test.ts` asserts every desktop-side surface above
AND forbids `FerroxLabs` from reappearing in them. These are the
highest-stakes lines in the repo: whoever owns the repos they name controls
code that downloads and runs on every user's machine.

In-app help/docs links also point at our repo: the "wiki" is the in-repo
`docs/` tree (`docs/README.md` is the home page), which is version-controlled
and survives with the fork. Upstream's GitHub wiki was never published (404),
so the old links were dead anyway. New user-facing guides go in
`docs/guides/` and get linked by blob URL
(`https://github.com/dmercer290-byte/wayland/blob/main/docs/...`).

Known remaining upstream references (deliberate, harmless - prose only, no
code delivery):

- `appId: com.ferroxlabs.wayland` - changing the appId makes installed apps
  treat the next version as a different application (new data dir, broken
  auto-update handoff). Leave it unless we ship a data migration.
- `IjfwSettingsPanel.tsx` brand link to `FerroxLabs/ijfw` (the IJFW project
  itself) and the author's X/Twitter "contact" link in the About dialog.
- `ClientFactory.ts` sends `HTTP-Referer: https://getwayland.com` as an
  attribution header on OpenAI-compatible requests - cosmetic.
- CI conditionals on `github.repository == 'FerroxLabs/wayland'` (coverage
  upload routing) and prose/issue references - inert on this repo.

## Releasing without upstream (first-release runbook)

Release builds **fail closed** until our own release streams exist:

1. **Engine first**: in wayland-core, tag a `vX.Y.Z-genesis-*` release (the
   Release workflow builds all six platform archives + a
   `genesis-core-checksums.txt`). If your environment cannot push tags
   (branch-scoped push access), dispatch the Release workflow instead with
   `tag_name` + `create_from_sha` - it creates the tag itself. Bump the `X.Y.Z` part on every release -
   the in-app engine updater compares only `major.minor.patch`, so a
   suffix-only bump (`-genesis-2`) is invisible to installed apps. Then run
   `node scripts/stage-wcore-bump.mjs <tag> --write` in this repo: it updates
   `DEFAULT_WCORE_VERSION` (`scripts/prepareWaylandCore.js`), the headless
   installer pin (`installer/scripts/postinstall.mjs`), and
   `scripts/bundled-wcore-shasums.json` from the published checksums.
2. **Desktop second**: run the release workflow here; installers bundle the
   engine from step 1 and publish to `dmercer290-byte/wayland` releases,
   which is also the auto-update feed for installed apps.

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
  `transcriptFormat.ts`, `episodicMemory.ts`, `memoryRecall.ts` (+ tests).
  The episodic sidecar distills each rotated transcript slice into compact
  per-conversation episodes (`.ijfw/memory/episodes.md`) before it becomes an
  opaque gzip; `memoryRecall.searchMemory` ranks episodes + live transcript
  for a query and is exposed as `ipcBridge.memory.searchMemory`.
- Hooks: `src/process/utils/message.ts` (`recordTranscriptMessage(...)` in
  `ConversationManageWithDB.sync()` - **the load-bearing line**; every agent
  manager and `TeamSession`/`TeammateManager` route through this store),
  `src/process/bridge/memoryArchiveBridge.ts` (toggle IPC providers +
  `invalidateTranscriptLoggingCache`), `src/common/adapter/ipcBridge.ts`
  (`memory.get/set-transcript-logging`), `src/common/config/storage.ts`
  (`memory.transcriptLogging` key),
  `src/renderer/pages/settings/IjfwSettingsPanel.tsx` (toggle UI)

### ASI-Evolve MCP tools (autonomous research)

Agent-callable tools (`asi_evolve_run/status/list`) that drive the external
ASI-Evolve Python framework, available in solo AND team wcore sessions. The
framework is not vendored - it runs as its own process from its own checkout.

- Fork-owned: `src/process/asiEvolve/*`, `scripts/setup-asi-evolve.sh`,
  `docs/guides/asi-evolve.md`
- Hooks: `src/process/task/WCoreManager.ts` (`getAsiEvolveStdioConfig`
  injection beside hub tools), `scripts/build-mcp-servers.js` (build entry for
  `asiEvolveMcpStdio.ts` → `out/main/asi-evolve-mcp-stdio.js`)

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

## Importing upstream code (exceptional, not routine)

Default answer to "upstream shipped X, should we merge?" is **no** - we build
and maintain our own changes. Import upstream code only when it clearly pays
its way (e.g. a security fix in code we still share), and then:

1. **Cherry-pick the specific commits**, never merge a release:
   `git remote add upstream https://github.com/FerroxLabs/wayland` (once),
   `git fetch upstream`, `git cherry-pick <sha>...`. Review the diff like a
   third-party PR - upstream's direction is no longer trusted by default.
2. Resolve conflicts with this document open:
   - Fork-owned files (listed below): keep ours.
   - Hook files: take the incoming change only where wanted **and keep the
     hook lines** (each is an import + 1-5 lines; the inventory below says
     exactly what goes where).
   - Locale JSON / `i18n-keys.d.ts`: union merge, then regenerate types.
3. Verify, in order:
   - `bun run test tests/unit/forkIntegrity.test.ts` - fork wiring AND
     independence guards intact
   - `bun run test tests/unit/process/services/memory/` - memory/transcript suite
   - `bun run typecheck && bun run test` - full check
   - `bun run i18n:types && node scripts/check-i18n.js` if locales changed

The `upstream-merge` skill (`.claude/skills/upstream-merge/SKILL.md`) encodes
this procedure.

## Keeping the codebase guarded (rules for new work)

The hook inventory below is no longer about merge conflicts - it is the map
of load-bearing wiring for the fork's flagship features, and the tripwire
test keeps any refactor (human or agent) from disconnecting them silently.

1. **New feature code goes in new files.** One directory or file per feature.
2. **Hooks stay tiny.** One import + one call/JSX element per hook site.
   If a hook grows past ~5 lines, extract the body into its own file.
3. **Every new hook gets a tripwire.** Add the file/needle to
   `tests/unit/forkIntegrity.test.ts` and an entry here, in the same PR.
4. **Never point build/update/release surfaces at repos we don't control.**
   New binary downloads follow the `prepareWaylandCore.js` pattern: pinned
   tag + SHA-256 manifest, sourced from our org.
