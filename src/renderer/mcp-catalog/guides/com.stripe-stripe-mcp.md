---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Stripe
    estSeconds: 30
    primaryAction: { label: "Sign in with Stripe", action: "oauth-flow" }
---

# Stripe setup

Stripe runs the MCP server. Sign in once to pick which account (and test vs.
live mode) Wayland can access.

## Step 2 — Sign in

A browser tab opens at Stripe. Pick the account, choose **read-only** or
**read-write**, and approve. You can revoke any time from Stripe → Connected
apps.
