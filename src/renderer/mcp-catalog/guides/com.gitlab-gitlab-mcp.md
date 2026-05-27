---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with GitLab
    estSeconds: 30
    primaryAction: { label: "Sign in with GitLab", action: "oauth-flow" }
---

# GitLab setup

GitLab runs the MCP server for gitlab.com (self-hosted GitLab supported via
config override).

## Step 2 — Sign in

A browser tab opens at GitLab. Approve the scopes and you're connected.
