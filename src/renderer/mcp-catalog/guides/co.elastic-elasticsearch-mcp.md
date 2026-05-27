---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: credentials
    title: Paste your Elasticsearch URL and API key
    estSeconds: 90
    externalAction: { label: "Start an Elastic Cloud trial", url: "https://www.elastic.co/cloud/cloud-trial-overview" }
    inputs:
      - { name: ES_URL, label: "Elasticsearch URL", secret: false }
      - { name: ES_API_KEY, label: "Elasticsearch API key", secret: true }
---

# Elasticsearch setup

Connects Wayland to any Elasticsearch cluster — Elastic Cloud, self-hosted, or
local. Read-only API keys are recommended.

## Step 2 — Get credentials

1. Open **Kibana → Stack Management → API keys**.
2. Click **Create API key**. Give it a name like `wayland-mcp` and grant only
   the index privileges you need (`read`, `view_index_metadata`).
3. Copy the encoded key once shown — Kibana won't display it again.
4. Paste your cluster URL (the value you'd use as `elasticsearch.hosts`) and
   the API key above.

The encoded key is the `encoded` field of the API key response. If you only
have `id` and `api_key`, base64-encode `id:api_key` and paste that.
