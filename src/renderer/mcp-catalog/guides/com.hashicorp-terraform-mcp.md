---
guideVersion: 1.0.0
estimatedMinutes: 3
steps:
  - id: install
    title: Install the MCP server (Docker)
    estSeconds: 60
    autoCompletedByInstall: true
  - id: token
    title: Paste your HCP Terraform token
    estSeconds: 120
    externalAction: { label: "Create an HCP Terraform token", url: "https://app.terraform.io/app/settings/tokens" }
    inputs:
      - { name: TFE_TOKEN, label: "HCP Terraform / TFE token", secret: true }
---

# Terraform setup

HashiCorp ships the Terraform MCP server as the
`hashicorp/terraform-mcp-server` Docker image. Wayland pulls the image on
install — make sure Docker Desktop (or another OCI runtime) is running.

## Step 2 — Token (optional but recommended)

You can use registry-only tools (search providers, browse modules) without a
token. To manage workspaces, runs, and the private registry you'll need an
HCP Terraform user or team token:

1. Open **HCP Terraform → User settings → Tokens** (or your team tokens page).
2. Click **Create an API token**, give it a description, and copy the token.
3. Paste it above as `TFE_TOKEN`.

For Terraform Enterprise installs, also override `TFE_ADDRESS` with your
TFE URL (default is `https://app.terraform.io`).
