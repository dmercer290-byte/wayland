---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: (Optional) Paste a Context7 API key for higher limits
    estSeconds: 30
    externalAction: { label: "Get a Context7 API key", url: "https://context7.com" }
---

# Context7 setup

Context7 is free for low-volume use — no key required. For higher rate limits
or org accounts, sign up at context7.com and add your key when prompted.

## Step 2 — (Optional) API key

If you have a Context7 key, paste it when Wayland asks. Otherwise just leave
it blank and you'll get the public limits.
