---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: authorize
    title: Sign in with Supabase
    estSeconds: 30
    primaryAction: { label: "Sign in with Supabase", action: "oauth-flow" }
---

# Supabase setup

Supabase runs the MCP server. Sign in once to authorize Wayland on the
projects you want to manage.

## Step 2 — Sign in

A browser tab opens at Supabase. Approve, choose project access, done.
