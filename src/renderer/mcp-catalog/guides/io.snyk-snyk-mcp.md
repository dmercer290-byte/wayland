---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the Snyk CLI
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: Paste your Snyk API token
    estSeconds: 90
    externalAction: { label: "Get an API token", url: "https://app.snyk.io/account" }
    inputs:
      - { name: SNYK_TOKEN, label: "Snyk API token", secret: true }
      - { name: SNYK_CFG_ORG, label: "Snyk organization ID (optional)", secret: false }
---

# Snyk setup

The Snyk MCP server ships inside the Snyk CLI (v1.1298.0 or later). Wayland
runs it via `npx snyk mcp -t stdio`.

## Step 2 — Get an API token

1. Open https://app.snyk.io/account.
2. Scroll to **General Account Settings → API Token** and click **Click to show**.
3. Copy the token and paste it above.
4. If your account spans multiple organizations, paste the target org slug into
   `SNYK_CFG_ORG`.

The server exposes `snyk_sca_scan`, `snyk_code_scan`, `snyk_iac_scan`, and
`snyk_container_scan` for open-source, code, infrastructure, and container
vulnerability checks.
