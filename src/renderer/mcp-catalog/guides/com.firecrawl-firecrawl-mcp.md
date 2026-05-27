---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: Paste your Firecrawl API key
    estSeconds: 60
    externalAction: { label: "Open Firecrawl dashboard", url: "https://www.firecrawl.dev/app" }
    inputs:
      - { name: FIRECRAWL_API_KEY, label: "Firecrawl API key", secret: true }
---

# Firecrawl setup

## Step 2 — API key

1. Sign in at firecrawl.dev.
2. Copy your API key from the dashboard.
3. Paste it above. Free-tier gives you a few hundred page-credits per month.
