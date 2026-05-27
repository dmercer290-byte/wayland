---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Connect your Zapier account
    estSeconds: 90
    primaryAction: { label: "Connect Zapier", action: "oauth-flow" }
    externalAction: { label: "Open Zapier MCP dashboard", url: "https://mcp.zapier.com" }
---

# Zapier setup

Zapier MCP lets Wayland trigger actions across 9,000+ apps — Gmail, Slack,
Salesforce, Notion, and the rest — using the same Zapier connections you
already have.

## Step 2 — Connect

Open `https://mcp.zapier.com`, pick which actions you want to expose, then
approve the OAuth connection from Wayland. Zapier manages all downstream
app credentials for you, so there's no separate key to paste.

You can rotate the connection or revoke specific actions any time from
the Zapier MCP dashboard.
