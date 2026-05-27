---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Neon
    estSeconds: 30
    primaryAction: { label: "Sign in with Neon", action: "oauth-flow" }
---

# Neon setup

Neon hosts the MCP server at `https://mcp.neon.tech/mcp`. Click sign in,
authorize Wayland against your Neon account, and you're done — no Postgres
connection strings to copy around.

## Step 2 — Sign in

A browser tab opens. Sign in with Neon and click **Authorize**. The token is
stored in your OS keychain; revoke any time from **Neon Console → Account
settings → Authorized apps**.

Heads up: the Neon MCP can create branches, run SQL, and drop databases — it's
a powerful tool. Wayland will confirm destructive actions before executing
them, but always read the diff Neon shows you.
