#!/usr/bin/env bash
#
# Genesis (Wayland fork) - one-line setup for Linux desktops and headless servers.
#
#   curl -fsSL https://raw.githubusercontent.com/dmercer290-byte/wayland/main/scripts/setup-genesis.sh | bash
#
# What it does:
#   1. Installs prerequisites (git, curl, unzip, Electron runtime libs; Xvfb on headless)
#   2. Installs bun (JS runtime) if missing
#   3. Clones (or updates) the fork into ~/genesis
#   4. Installs app dependencies
#   5. Prints exactly how to start it for your situation
#
# Safe to re-run: it updates an existing install instead of re-cloning.

set -euo pipefail

REPO_URL="https://github.com/dmercer290-byte/wayland.git"
INSTALL_DIR="${GENESIS_DIR:-$HOME/genesis}"

log() { printf '\n\033[1;32m[genesis-setup]\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[genesis-setup]\033[0m %s\n' "$*"; }

if [[ "$(uname -s)" != "Linux" ]]; then
  warn "This script targets Linux. On Windows/Mac, follow WHATS_NEW.md → Running it."
  exit 1
fi

SUDO=""
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else
    warn "Not root and no sudo available - system packages must already be installed."
  fi
fi

HEADLESS=0
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  HEADLESS=1
fi

# 1. System packages ---------------------------------------------------------
if [[ -n "$SUDO" || $EUID -eq 0 ]] && command -v apt-get >/dev/null 2>&1; then
  log "Installing system packages (git, curl, unzip, Electron libs)..."
  $SUDO apt-get update -qq
  # Electron runtime libraries for Debian/Ubuntu; harmless if already present.
  $SUDO apt-get install -y -qq git curl unzip \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 \
    libgbm1 libasound2 libxss1 libxtst6 libxdamage1 libxrandr2 libxcomposite1 \
    2>/dev/null || $SUDO apt-get install -y git curl unzip \
    libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgtk-3-0t64 \
    libgbm1 libasound2t64 libxss1 libxtst6 libxdamage1 libxrandr2 libxcomposite1
  if [[ $HEADLESS -eq 1 ]]; then
    log "No display detected - installing Xvfb (virtual display for headless servers)..."
    $SUDO apt-get install -y -qq xvfb
  fi
else
  warn "Skipping system packages (no apt or no sudo). Ensure git/curl/unzip and Electron libs exist."
fi

# 2. bun ---------------------------------------------------------------------
if ! command -v bun >/dev/null 2>&1 && [[ ! -x "$HOME/.bun/bin/bun" ]]; then
  log "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
log "bun $(bun --version)"

# 3. Clone or update ---------------------------------------------------------
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Updating existing install at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Cloning into $INSTALL_DIR..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

# 4. App dependencies --------------------------------------------------------
log "Installing app dependencies (this takes a few minutes the first time)..."
cd "$INSTALL_DIR"
bun install

# 5. How to start ------------------------------------------------------------
log "Setup complete."
if [[ $HEADLESS -eq 1 ]]; then
  cat <<'EOF'

  This is a HEADLESS server (no display). Start Genesis under a virtual display:

      cd ~/genesis && xvfb-run -a bun start

  Then enable remote access: in the app settings turn on the WebUI
  (Settings → General → WebUI) and open http://<server-ip>:<port> from
  another machine. Full guide: docs/guides/deploy-server.md in the repo.
EOF
else
  cat <<'EOF'

  Start Genesis with:

      cd ~/genesis && bun start

  After code updates, re-run this script (or: git pull && bun install).
EOF
fi
