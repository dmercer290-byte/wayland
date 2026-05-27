---
guideVersion: 1.0.0
estimatedMinutes: 5
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: pick-project
    title: Pick a Google Cloud project
    estSeconds: 60
    externalAction: { label: "Open Google Cloud console", url: "https://console.cloud.google.com" }
    inputs:
      - { name: GCLOUD_PROJECT, label: "Project ID" }
  - id: service-account
    title: (Optional) Use a service account key
    estSeconds: 120
    inputs:
      - { name: GOOGLE_APPLICATION_CREDENTIALS, label: "Path to service account JSON" }
    warning: |
      Prefer **gcloud auth application-default login** over service account
      keys when possible. Service account keys are long-lived secrets.
  - id: authorize
    title: Sign in with Google Cloud
    estSeconds: 30
    primaryAction: { label: "Sign in with Google", action: "oauth-flow" }
---

# Google Cloud setup

The MCP uses Google's Application Default Credentials. Easiest path: sign in
through the Wayland OAuth flow. Power users can drop a service account key
file and point the env var at it.

## Step 2 — Pick a project

1. Open the Google Cloud console.
2. Copy the **Project ID** of the project you want Wayland to manage by
   default. Paste it above.

## Step 3 — Sign in

Click **Sign in with Google** and approve the `cloud-platform` scope. You're
connected.
