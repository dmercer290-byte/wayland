# What's New in This Fork

Everything added to the `dmercer290-byte` forks in the July 2026 working session —
covering both repositories:

| Repo | What it is | State |
| --- | --- | --- |
| **`dmercer290-byte/wayland`** | The desktop app (Electron) | All features below merged to `main`, **rebased onto upstream v0.11.13** (bundles wayland-core v0.12.22) |
| **`dmercer290-byte/wayland-core`** | The engine, rebranded **Genesis** (Rust) | Rebrand + 2 fixes merged to `main` |

---

## 1. The Genesis Rebrand (`wayland-core`)

The entire engine was rebranded from **Wayland → Genesis**: 667 files, the
binary (`wayland-core` → `genesis-core`), five plugin crates (`genesis-browser`,
`genesis-cua`, `genesis-honcho`, `genesis-ijfw`, `genesis-ollama`), env vars
(`GENESIS_*`), config dirs, docs, and CI.

Deliberately preserved:

- **Linux display-protocol code** — this codebase also touches Wayland *the
  Linux display server* (screen control). `WAYLAND_DISPLAY`, the compositor
  probes, `Xwayland`, and the `wayland`/`wayland-test` cargo features keep
  their correct names.
- **ChatGPT OAuth `originator` header** — server-validated; renaming would
  break logins.
- **Legal files** — LICENSE and CHANGELOG untouched; NOTICE credits the
  upstream Wayland Core project (Apache-2.0) as required.

Verified: the full 55-crate workspace compiles; the binary reports
`genesis-core 0.12.20`.

## 2. Upstream Bug Fixes

### Engine (`wayland-core`, from FerroxLabs issues)

- **#136 — memory-exhaustion guard**: the OpenAI streaming path now caps the
  server-supplied tool-call index at 128 slots (fail-closed), so a malicious
  or buggy endpoint can't force a billion-entry allocation with one frame.
- **#135 — duplicate MCP servers**: re-adding an MCP server with a known name
  now *replaces* it — same-named tools swap in place (breaker state kept),
  stale tools are retired, and the old child process is shut down.
- #139 (tool-name sanitization) and #125 (Windows AppContainer hang) were
  already fixed on the upstream main this fork tracks; #113 (browser tool)
  and #126 (stale npx) need upstream product/publishing decisions.

### Desktop app (`wayland`, from FerroxLabs issues)

- **#587 — model selector missing in workflows**: workflows previously
  hard-disabled model switching. Dedicated workflow panels now wire the real
  model-selection hooks and surface the selector under the workflow header —
  you can switch models mid-workflow (e.g., when one runs out of credits).
- **#572 — broken ijfw install command**: the troubleshooting UI told users to
  run `npx -y @ijfw/install@latest`, which fails ("could not determine
  executable to run" — the package exposes three binaries). Corrected to
  `npx -y --package @ijfw/install@latest ijfw-install` in the UI and all 13
  places it appeared across locales.
- **#555 — teams billed to OpenRouter instead of the chosen subscription**:
  fixed in the fork first; upstream v0.11.12 later shipped its own, more
  complete fix (provider-ownership resolution + ChatGPT-subscription
  preference), which this fork now carries after the upstream merge.

## 3. Memory Transcript System

**Every chat message, tool call, and thinking block is mirrored into memory**
(`<workspace>/.ijfw/memory/transcript.md`) and shows on the Memory page,
tagged `transcript` / `chat` / `tool-call` / `thought` plus a per-conversation
tag.

- **Debounced**: streamed responses land once, settled (5s quiet window) — not
  as hundreds of partial chunks.
- **Auto-compression**: past 1 MB, older entries are gzipped into
  `.ijfw/memory/transcript-archive/` (outside the Memory index, so scans stay
  fast) and only the newest ~256 KB of whole entries stay live. Rotation never
  tears an entry and uses write-then-rename so a crash can't corrupt the file.
- **Secret redaction**: API keys (OpenAI/Anthropic, GitHub, AWS, Slack,
  Google), JWTs, Bearer tokens, and `api_key: ...` assignments are masked to
  `[REDACTED]` before anything touches disk.
- **Toggle**: Settings → IJFW Memory → "Log conversation transcripts to
  memory" (on by default; applies immediately).
- Transcript logging is disk-only — it never costs tokens.

## 4. Context Modes (Economy / Light / Max)

**Settings → General → "Context mode"** controls when the Genesis engine
auto-compacts long conversations before re-sending them to the model:

| Mode | Behavior | Use when |
| --- | --- | --- |
| **Economy** | Compacts around ~50K tokens; keeps 3 recent tool results | You pay per token and run long sessions |
| **Light** (default) | Engine defaults; compacts near the context limit | Balanced |
| **Max** | Holds context as long as possible; keeps 10 tool results | Recall matters more than cost |

Applies to new engine sessions via the generated `.wcore.toml`; raw-engine
(power-user) mode is untouched.

## 5. Model Hub (multi-server dashboard + VRAM swap)

**Settings → Models → "Model Hub"** — one dashboard over every model server
you run:

- Add servers by base URL; the kind is auto-detected — **Ollama** (native API)
  or **OpenAI-compatible** (LM Studio, vLLM, llama.cpp server).
- One table of all models across all servers: size, per-server online/offline
  badges, and live **"in VRAM"** badges (from Ollama `/api/ps`).
- **Load** on an Ollama model performs the VRAM swap: every other resident
  model is unloaded first (`keep_alive: 0`), then the picked model is warmed
  with an empty generate request so the weights are resident before your
  first message.
- One dead server never breaks the dashboard; all requests carry a 7s timeout.

## 6. Cost Visibility

- **Live cost badge** in every chat header: cumulative spend for that
  conversation (tooltip: dollars + tokens), refreshed every 30s. Appears once
  the conversation has recorded a costed turn.
- **Token usage calendar** in Mission Control → Cost: a heatmap with **Hour**
  (7 days × 24h), **Day** (12-week GitHub-style grid), **Week** (26 weeks),
  and **Month** (12 true calendar months) views, plus a per-model filter.
  Every cell's tooltip shows total tokens, dollar cost, the
  **input / output / cache-read split**, and (in All-models view) the top-5
  models with in/out arrows.
- These sit on top of the pre-existing Mission Control Cost tab (spend cards,
  trend, breakdowns) and the Budgets panel (spend caps with per-turn
  enforcement) — glance → analyze → enforce.

## 7. Rate-Limit-Aware Scheduling

Scheduled tasks now recover from provider rate limits instead of just failing:

- **Short-window hit** (Claude/Gemini ~5-hour rolling windows): the run is
  automatically rescheduled at the window reset — parsed from the error
  ("try again in 2 hours", "retry-after: 3600"), defaulting to **+5 hours**.
  The retry time shows as the job's next run.
- **Weekly cap hit**: the job switches its conversation to your configured
  **fallback model** and retries once, reporting the switch in the job
  status. Configure it in **Settings → General → "Rate-limit fallback
  model"** — point it at any provider you have set up (OpenRouter, ZenMux, …).
- The classifier is conservative: ambiguous limits are treated as
  short-window (a delayed retry is always safe; a wrong model switch is not).
- Caveat: the deferred retry is an in-app timer; if you quit the app before it
  fires, the job's regular schedule is the backstop.

---

## New configuration keys

| Key | Where set | Meaning |
| --- | --- | --- |
| `memory.transcriptLogging` | Settings → IJFW Memory | Mirror chats/tools/thoughts into transcript.md (default on) |
| `wcore.compactMode` | Settings → General | `economy` \| `light` \| `max` |
| `modelHub.servers` | Settings → Models → Model Hub | Registered model servers |
| `rateLimit.fallbackModel` | Settings → General | `{ providerId, useModel }` weekly-cap failover |

## Verification status

- **Automated**: 76+ unit tests across the new features (transcript format
  round-trips, redaction patterns, rotation boundaries, Model Hub aggregation
  and unload-before-load ordering, rate-limit classification, compact-mode
  wiring, engine index-cap and MCP idempotency); TypeScript strict, oxlint,
  and i18n validation all clean; all UI strings localized in 12 languages.
- **Engine**: full Rust workspace compiles; binary smoke-tested.
- **Not yet done**: a human click-through of the real UI. This container
  cannot run Electron, so layouts, the heatmap rendering, and the VRAM swap
  against real hardware still need your eyes — that's the current test pass.

## Running it

```bash
git clone https://github.com/dmercer290-byte/wayland.git
cd wayland
bun install
bun start
```

Engine (optional, for CLI use):

```bash
git clone https://github.com/dmercer290-byte/wayland-core.git
cd wayland-core
cargo build --release -p wcore-cli --bin genesis-core
```

## Idea backlog (discussed, not yet built)

Session digests (AI-written per-session summaries into memory), a Transcripts
tab with search/filters on the Memory page, auto-promotion of recurring facts,
local-first / cost-aware routing, budget-aware economy degradation, Model Hub
pull-from-dashboard and VRAM capacity bars, transcript export, and
"resume from transcript" session continuity.
