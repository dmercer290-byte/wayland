# Remote Agent Guide

Connect Wayland to a remote agent service (currently OpenClaw gateways) so
conversations can be driven by an agent running on another machine.

This page is the in-app "View setup guide" target from **Settings → Agents →
Remote Agents**. (It replaces an upstream wiki link that was never published.)

## Table of Contents

- [What is a Remote Agent?](#what-is-a-remote-agent)
- [Adding a Remote Agent](#adding-a-remote-agent)
- [Pairing / Gateway Approval](#pairing--gateway-approval)
- [Connection Statuses](#connection-statuses)
- [Troubleshooting](#troubleshooting)

## What is a Remote Agent?

A remote agent is an agent service reachable over the network instead of a
CLI bundled on your machine. Wayland connects to its URL, authenticates, and
routes conversations to it. Only remote **OpenClaw** connections are supported
for now; other protocols are in development.

## Adding a Remote Agent

Open **Settings → Agents → Remote Agents → Add** and fill in:

| Field | Meaning |
| --- | --- |
| Name | Display name, e.g. "My Remote Agent" |
| URL | The remote agent service endpoint |
| Authentication | `None`, `Bearer Token`, or `Token` — as required by the service |
| Description | Optional note |
| Allow Insecure Connection | Skips TLS certificate verification. Only for self-signed certificates on hosts you control |

Use **Test Connection** to verify reachability before saving.

## Pairing / Gateway Approval

For OpenClaw gateways, saving the agent starts a pairing handshake:

1. Wayland registers the device with the gateway and shows
   **"Waiting for gateway approval…"**.
2. Approve the device **on the OpenClaw Gateway side**.
3. Wayland polls the gateway every 5 seconds. As soon as the gateway approves,
   the agent flips to **connected** and is ready to use.
4. The approval request expires after **5 minutes**. If it times out, delete or
   re-save the agent to start a fresh pairing.

## Connection Statuses

| Status | Meaning |
| --- | --- |
| connected | Handshake complete; the agent is usable |
| pending | Waiting for gateway approval |
| error | Last connection attempt failed — re-test the connection |

## Troubleshooting

- **Test Connection fails** — check the URL is reachable from this machine
  (VPN, firewall, port) and the auth token is valid.
- **Stuck on "Waiting for gateway approval"** — the approval must happen on
  the gateway, not in Wayland. If nobody approves within 5 minutes the request
  expires.
- **TLS errors with a self-signed certificate** — either install the CA on
  this machine (preferred) or enable *Allow Insecure Connection* for that
  agent only.
- Remote access to Wayland itself (WebUI from other devices) is a different
  feature — see [webui.md](webui.md#remote-access) and
  [deploy-server.md](deploy-server.md).
