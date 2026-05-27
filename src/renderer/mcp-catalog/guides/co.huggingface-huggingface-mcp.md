---
guideVersion: 1.0.0
estimatedMinutes: 2
steps:
  - id: install
    title: Connect to the hosted MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: api-key
    title: Paste your Hugging Face access token
    estSeconds: 90
    externalAction: { label: "Create an access token", url: "https://huggingface.co/settings/tokens" }
    inputs:
      - { name: HF_TOKEN, label: "Hugging Face access token", secret: true }
---

# Hugging Face setup

The Hugging Face MCP server is hosted at `https://huggingface.co/mcp` and uses a
personal access token sent as a Bearer header.

## Step 2 — Get an access token

1. Open https://huggingface.co/settings/tokens.
2. Click **New token**, pick the `read` role (or `fine-grained` with the
   specific permissions you need), and copy the token.
3. Paste the token above.

You can manage which built-in tools and Spaces are exposed from
https://huggingface.co/settings/mcp.
