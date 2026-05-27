---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: connection
    title: Paste your Postgres connection string
    estSeconds: 60
    inputs:
      - { name: DATABASE_URL, label: "postgres://… connection string", secret: true }
    warning: |
      For production databases, create a **read-only role** and use its
      credentials. The MCP defaults to read-only mode but enforcing it at the
      role level is safer.
---

# Postgres setup

## Step 2 — Connection string

Paste a standard Postgres URL above:

```
postgres://username:password@host:5432/database?sslmode=require
```

The server only opens read-only transactions unless you opt into write mode
from settings.
