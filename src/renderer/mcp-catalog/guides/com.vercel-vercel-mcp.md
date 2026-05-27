---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Vercel
    estSeconds: 30
    primaryAction: { label: "Sign in with Vercel", action: "oauth-flow" }
---

# Vercel setup

Vercel runs the MCP server. Sign in to pick a team/scope.

## Step 2 — Sign in

A browser tab opens at Vercel. Choose the team, approve the scopes, and you're
done.
