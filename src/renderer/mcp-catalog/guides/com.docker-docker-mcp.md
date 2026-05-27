---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
---

# Docker setup

No configuration. The server talks to your local Docker daemon over the
default socket. You'll need **Docker Desktop** (macOS/Windows) or the Docker
Engine (Linux) installed and running.

If your daemon isn't on the default socket, set `DOCKER_HOST` in your shell
before launching Wayland.
