---
guideVersion: 1.0.0
estimatedMinutes: 4
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: credentials
    title: Paste your AWS access key + secret
    estSeconds: 180
    externalAction: { label: "Open AWS IAM console", url: "https://console.aws.amazon.com/iam" }
    inputs:
      - { name: AWS_ACCESS_KEY_ID, label: "Access key ID" }
      - { name: AWS_SECRET_ACCESS_KEY, label: "Secret access key", secret: true }
      - { name: AWS_DEFAULT_REGION, label: "Default region", default: "us-east-1" }
      - { name: AWS_SESSION_TOKEN, label: "Session token (optional)", secret: true }
    warning: |
      Create a **scoped IAM user** with only the permissions you need. Never
      paste root account credentials. For maximum safety, generate short-lived
      credentials via AWS SSO / STS and use the session token field.
---

# AWS setup

## Step 2 — Create IAM credentials

1. Open the **AWS IAM** console.
2. Create a user (or role) with the policies that match the services you'll
   use (e.g. `AmazonS3ReadOnlyAccess`, `AmazonEC2ReadOnlyAccess`).
3. Under **Security credentials → Access keys**, generate a new key.
4. Paste the access key ID and secret above. Set your default region.

For production accounts, prefer temporary credentials over long-lived keys.
