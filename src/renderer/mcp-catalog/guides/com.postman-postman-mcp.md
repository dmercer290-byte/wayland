---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: Paste your Postman API key
    estSeconds: 90
    externalAction: { label: "Generate an API key", url: "https://postman.co/settings/me/api-keys" }
    inputs:
      - { name: POSTMAN_API_KEY, label: "Postman API key", secret: true }
---

# Postman setup

Postman ships an official MCP server on npm as `@postman/postman-mcp-server`.
Wayland runs it via `npx` with stdio transport.

## Step 2 — Get an API key

1. Open https://postman.co/settings/me/api-keys.
2. Click **Generate API Key**, name it (for example "Wayland MCP"), and copy
   the key.
3. Paste the key above.

The default `--minimal` profile exposes 37 tools across workspaces,
collections, environments, and API specs. Switch to `--full` for the complete
100+ tool surface or `--code` for code-generation focus.
