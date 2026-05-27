---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Sentry
    estSeconds: 30
    primaryAction: { label: "Sign in with Sentry", action: "oauth-flow" }
---

# Sentry setup

Sentry runs the MCP server. Sign in once, choose the organization, and you're
connected.

## Step 2 — Sign in

A browser tab opens at Sentry. Approve, pick your org, done.
