---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Sourcegraph
    estSeconds: 30
    primaryAction: { label: "Sign in with Sourcegraph", action: "oauth-flow" }
---

# Sourcegraph setup

Sourcegraph runs the MCP server. Sign in once to authorize access to your
indexed repositories.

## Step 2 — Sign in

A browser tab opens at Sourcegraph. Approve and you're connected.
