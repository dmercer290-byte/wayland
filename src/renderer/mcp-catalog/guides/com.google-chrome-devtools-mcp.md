---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
---

# Chrome DevTools setup

No configuration. The server launches a Chromium instance via the DevTools
Protocol. If you already have Chrome installed, Wayland will use it; otherwise
it downloads a small headless Chromium build on first run.
