---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Figma
    estSeconds: 30
    primaryAction: { label: "Sign in with Figma", action: "oauth-flow" }
---

# Figma setup

Figma hosts the MCP server. Click sign in, allow access to your Figma
account, and Wayland can read design files, variables, components, and
Dev Mode metadata.

## Step 2 — Sign in

A browser tab opens with Figma's "Allow Access" prompt. Approve it and
the connection is live. Your token lives in your OS keychain — revoke
any time from Figma's connected apps settings.

The MCP server respects your existing Figma permissions: it can only see
files you can already see.
