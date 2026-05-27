---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with monday.com
    estSeconds: 30
    primaryAction: { label: "Sign in with monday.com", action: "oauth-flow" }
---

# monday.com setup

monday.com hosts the MCP server at `https://mcp.monday.com/mcp`. The
integration is preinstalled on every monday account at no extra cost.

## Step 2 — Sign in

A browser tab opens. Sign in and approve board, user, and workspace read
access (plus board writes if you want the agent to update items). All MCP
calls execute as you — anything you can't see in the app, the agent can't
see either.

Revoke any time at `<your-account>.monday.com/admin/integrations/api/oauth`.
