---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Box
    estSeconds: 60
    primaryAction: { label: "Sign in with Box", action: "oauth-flow" }
---

# Box setup

Box hosts the MCP server at `https://mcp.box.com`. Click sign in, approve the
folders Wayland may touch, and you're done.

## Step 2 — Sign in

A browser tab opens to `account.box.com`. You'll be asked to grant three
scopes: file read/write, Box AI, and Doc Gen. Pick which folders the
integration may access — start narrow; you can widen later from Box's
connected apps settings.

Your token lives in your OS keychain. Revoke any time at
`app.box.com/account/connected-apps`.
