---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Intercom
    estSeconds: 30
    primaryAction: { label: "Sign in with Intercom", action: "oauth-flow" }
---

# Intercom setup

Intercom hosts the MCP server at `https://mcp.intercom.com/mcp`. Click sign
in and approve read access to conversations, users, and companies.

## Step 2 — Sign in

A browser tab opens to `intercom.com`. Approve the two read scopes — the
server is read-only, so the agent can search conversations and contacts but
cannot send messages.

**Region note:** US-hosted Intercom workspaces only. EU and AU workspaces
are not supported yet.

Revoke any time from Intercom's connected apps settings.
