#!/usr/bin/env bash
# Install ASI-Evolve (github.com/GAIR-NLP/ASI-Evolve) so the Wayland agent's
# asi_evolve_* MCP tools can drive it. Clones the framework and creates an
# isolated Python venv - nothing is vendored into this repo.
#
# Target dir: $ASI_EVOLVE_DIR, else the app's userData/asi-evolve. Pass a path
# as $1 to override. Re-runnable (pulls + reinstalls).
set -euo pipefail

REPO="${ASI_EVOLVE_REPO:-https://github.com/GAIR-NLP/ASI-Evolve}"
DIR="${1:-${ASI_EVOLVE_DIR:-}}"

if [ -z "$DIR" ]; then
  case "$(uname -s)" in
    Darwin) DIR="$HOME/Library/Application Support/Wayland/asi-evolve" ;;
    *)      DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Wayland/asi-evolve" ;;
  esac
fi

echo "ASI-Evolve install dir: $DIR"
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 (3.10+) is required" >&2; exit 1; }

if [ -d "$DIR/.git" ]; then
  echo "Updating existing checkout..."
  git -C "$DIR" pull --ff-only
else
  mkdir -p "$(dirname "$DIR")"
  git clone --depth 1 "$REPO" "$DIR"
fi

echo "Creating venv + installing requirements..."
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/python" -m pip install --upgrade pip
if [ -f "$DIR/requirements.txt" ]; then
  "$DIR/.venv/bin/python" -m pip install -r "$DIR/requirements.txt"
fi

cat <<EOF

ASI-Evolve installed at: $DIR
Restart Wayland (or start a new chat/team) and the asi_evolve_run /
asi_evolve_status / asi_evolve_list tools will be available to the agent.

The framework reads its LLM endpoint from config.yaml's 'api:' block
(base_url / api_key / model), NOT from OPENAI_* env vars. Three ways to set it:
  1. Pass base_url/api_key/model straight to the asi_evolve_run tool (per run).
  2. Export before launching Wayland (passed through, overridable per run):
       export ASI_EVOLVE_BASE_URL=http://localhost:3000/v1   # your Wayland/WebUI server
       export ASI_EVOLVE_API_KEY=...
       export ASI_EVOLVE_MODEL=...
  3. Edit $DIR/config.yaml directly (supports \${ENV_VAR} placeholders).
See docs/guides/asi-evolve.md.
EOF
