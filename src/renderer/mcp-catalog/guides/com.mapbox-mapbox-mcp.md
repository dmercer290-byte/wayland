---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: Paste your Mapbox access token
    estSeconds: 90
    externalAction: { label: "Get an access token", url: "https://account.mapbox.com/access-tokens/" }
    inputs:
      - { name: MAPBOX_ACCESS_TOKEN, label: "Mapbox access token", secret: true }
---

# Mapbox setup

Mapbox runs the server locally via `npx @mapbox/mcp-server`. The free tier
covers 50,000 monthly map loads and 100,000 geocoding requests — plenty for
agent use.

## Step 2 — Get a token

1. Open `account.mapbox.com/access-tokens/`.
2. Click **Create a token** (or use your default public token).
3. For agent use the default scopes are fine: styles, fonts, datasets, vision.
4. Paste the token above.

Offline tools (distance, bearing, area, buffer, etc.) run without hitting
the API — only geocoding, routing, and imagery consume quota.
