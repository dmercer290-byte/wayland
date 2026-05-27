---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Cloudflare
    estSeconds: 30
    primaryAction: { label: "Sign in with Cloudflare", action: "oauth-flow" }
---

# Cloudflare Suite setup

Cloudflare runs the MCP server. Sign in once to grant Wayland access to the
accounts and zones you choose.

## Step 2 — Sign in

A browser tab opens at Cloudflare. Pick the account, approve, and you're
done.
