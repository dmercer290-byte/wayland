---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with GitHub
    estSeconds: 30
    primaryAction: { label: "Sign in with GitHub", action: "oauth-flow" }
---

# GitHub setup

GitHub runs the MCP server. One click and you're connected — no PAT, no
local app.

## Step 2 — Sign in

A browser tab opens at GitHub. Approve the requested scopes (or restrict to
specific repos with a Resource Owner override) and you're done. Tokens are
stored in your local OS keychain.
