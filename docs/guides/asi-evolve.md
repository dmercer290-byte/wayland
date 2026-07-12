# ASI-Evolve Integration

[ASI-Evolve](https://github.com/GAIR-NLP/ASI-Evolve) (GAIR-NLP, Apache-2.0) is
an autonomous-research framework: given a problem, an evaluation metric, and
domain knowledge, it cycles through knowledge retrieval → hypothesis design →
experimentation → analysis to discover novel solutions.

Wayland integrates it as an **MCP tool set available to the agent in both
regular chats and team sessions** - the agent can launch research runs and
poll them. ASI-Evolve is **not vendored**: it runs as its own Python process
with its own venv, driven over MCP. No Python enters this repo, and there is
no combined-work licensing question.

## Install

```bash
bash scripts/setup-asi-evolve.sh          # installs to userData/asi-evolve
# or a custom location:
ASI_EVOLVE_DIR=/opt/asi-evolve bash scripts/setup-asi-evolve.sh
```

This clones the framework and builds an isolated venv. It is re-runnable
(pulls + reinstalls). Requires `git` and `python3` (3.10+).

ASI-Evolve reads its LLM endpoint from `config.yaml`'s `api:` block
(`base_url` / `api_key` / `model`) — **not** from `OPENAI_*` env vars (verified
against the framework's `utils/config.py`). Set it any of three ways:

1. **Per run** — pass `base_url` / `api_key` / `model` straight to the
   `asi_evolve_run` tool. Wayland writes a per-run override config that
   `--config` deep-merges over the defaults.
2. **Preconfigured** — export before launching Wayland (passed through to every
   run, still overridable per run):
   ```bash
   export ASI_EVOLVE_BASE_URL=http://localhost:3000/v1   # your Wayland/WebUI server
   export ASI_EVOLVE_API_KEY=...
   export ASI_EVOLVE_MODEL=...
   ```
3. **Edit `config.yaml`** in the install dir directly. It supports
   `${ENV_VAR}` placeholders, so `api_key: "${MY_KEY}"` resolves from the
   environment at run time.

## Tools the agent gets

Injected into every desktop-managed wcore session (solo and team) once the
framework is installed - `WCoreManager` reads `getAsiEvolveStdioConfig`, which
returns null (no tools) until `main.py` exists at the install dir.

| Tool | Purpose |
| --- | --- |
| `asi_evolve_run` | Launch a research run in the background (returns a run id; runs are long-lived). Args: `experiment`, `steps`, optional `eval_script`, optional `extra_args`. |
| `asi_evolve_status` | Report a run's state (running / completed / failed) + log tail. |
| `asi_evolve_list` | List recent runs. |

Runs and their logs live under `<install dir>/runs/<run id>/`.

## Architecture

- `src/process/asiEvolve/asiEvolveFormat.ts` - pure helpers (dir/python
  resolution, argv construction, run-state inference); unit-tested.
- `src/process/asiEvolve/asiEvolveMcpStdio.ts` - the stdio MCP server; spawns
  `python main.py` detached, streams to a per-run log, records exit.
- `src/process/asiEvolve/asiEvolveSingleton.ts` - builds the stdio launch
  config (or null when not installed).
- Build entry: `scripts/build-mcp-servers.js` → `out/main/asi-evolve-mcp-stdio.js`.
- Injection: `src/process/task/WCoreManager.ts`, beside the hub tools.

## Notes / next steps

- The CLI flags (`--experiment/--steps/--eval-script`) follow ASI-Evolve's
  README; `extra_args` passes anything else straight through, so a framework
  update that adds flags doesn't require a Wayland change.
- Runs execute real code on the host (that is what an autonomous-research
  framework does) - run it on a machine you trust, ideally the same
  self-hosted box that builds your releases.
- A future upgrade: expose runs in the desktop UI (cost/progress) rather than
  only through the agent's tool calls.
