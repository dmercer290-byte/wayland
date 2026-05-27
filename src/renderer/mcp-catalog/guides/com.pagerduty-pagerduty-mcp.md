---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: Paste your PagerDuty user API token
    estSeconds: 90
    externalAction: { label: "Create a user API token", url: "https://support.pagerduty.com/main/docs/api-access-keys#section-generating-a-user-token-rest-api-key" }
    inputs:
      - { name: PAGERDUTY_USER_API_KEY, label: "PagerDuty user API token", secret: true }
---

# PagerDuty setup

PagerDuty's official MCP server is published to PyPI as `pagerduty-mcp` and
runs locally via `uvx`.

## Step 2 — Get a user API token

1. Sign in to PagerDuty and click your avatar (top-right) → **My Profile**.
2. Open the **User Settings** tab.
3. Under **API Access**, click **Create API User Token**, give it a label, and
   copy the token.
4. Paste the token above.

User tokens scope to your account permissions — incidents you can't see in the
UI won't appear here either.
