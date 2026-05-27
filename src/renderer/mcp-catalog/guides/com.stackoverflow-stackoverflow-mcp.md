---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Connect to the hosted MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: oauth
    title: Sign in with Stack Overflow
    estSeconds: 30
    externalAction: { label: "Create a Stack Overflow account", url: "https://stackoverflow.com/users/signup" }
---

# Stack Overflow setup

Stack Overflow's official MCP server is hosted at `https://mcp.stackoverflow.com`
and signs you in via OAuth — no API key required.

## Step 2 — Sign in

1. Wayland will open a browser window to Stack Overflow's OAuth consent screen.
2. Sign in with your existing Stack Overflow account (or create a free one).
3. Approve the requested permissions and you'll be redirected back to Wayland.

The free tier covers normal search workloads. Higher-volume teams can upgrade
through Stack Overflow's enterprise plans.
