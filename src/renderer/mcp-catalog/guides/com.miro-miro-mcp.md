---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Miro
    estSeconds: 30
    primaryAction: { label: "Sign in with Miro", action: "oauth-flow" }
---

# Miro setup

Miro hosts the MCP server at `https://mcp.miro.com/`. Sign in, approve the
`boards:read` and `boards:write` scopes, and Wayland can read and edit
sticky notes, frames, shapes, and connectors on boards you have access to.

## Step 2 — Sign in

A browser tab opens with Miro's OAuth approval screen. After you allow
access, the connection is live and your token lives in your OS keychain.

The MCP server respects all existing board permissions — it can only see
or edit boards you already have access to.
