---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: Paste your Exa API key
    estSeconds: 60
    externalAction: { label: "Open Exa dashboard", url: "https://dashboard.exa.ai" }
    inputs:
      - { name: EXA_API_KEY, label: "Exa API key", secret: true }
---

# Exa setup

## Step 2 — API key

1. Open the Exa dashboard and sign in.
2. Copy your API key.
3. Paste it above. Free-tier has a generous monthly quota.
