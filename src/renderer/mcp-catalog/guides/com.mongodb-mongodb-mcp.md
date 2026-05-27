---
guideVersion: 1.0.0
estimatedMinutes: 3
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: connection-string
    title: Paste your MongoDB connection string
    estSeconds: 150
    externalAction: { label: "Get a free Atlas cluster", url: "https://www.mongodb.com/cloud/atlas/register" }
    inputs:
      - { name: MDB_MCP_CONNECTION_STRING, label: "MongoDB connection string", secret: true }
---

# MongoDB setup

The official MongoDB MCP can talk to a local mongod, a self-hosted cluster, or
MongoDB Atlas. Pick one of the paths below.

## Step 2 — Provide credentials

**Atlas (recommended):**

1. Open your Atlas project → **Database → Connect → Drivers**.
2. Copy the `mongodb+srv://...` connection string and replace `<password>` with
   a database user password (create one under **Database Access** if needed).
3. Paste it above as `MDB_MCP_CONNECTION_STRING`.

**Local or self-hosted:** paste your `mongodb://user:pass@host:27017/db`
connection string the same way.

For Atlas administration tools (create clusters, manage users) also set
`MDB_MCP_API_CLIENT_ID` and `MDB_MCP_API_CLIENT_SECRET` from
**Atlas → Organization → Access Manager → API Keys**.
