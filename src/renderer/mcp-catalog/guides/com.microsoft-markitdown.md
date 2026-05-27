---
guideVersion: 1.0.0
estimatedMinutes: 1
steps:
  - id: install
    title: Install the MCP server
    estSeconds: 30
    autoCompletedByInstall: true
  - id: ready
    title: Ready to convert
    estSeconds: 15
---

# Markitdown setup

Markitdown is Microsoft's local utility for converting PDFs, Word docs,
PowerPoint, Excel, images, HTML, and audio into clean Markdown that LLMs can
actually read.

No account, no API key, no network calls. The server runs locally via `uvx`
and processes files from disk or HTTP/HTTPS URIs.

## Step 2 — Ready to convert

Once installed, ask Wayland things like "convert this PDF to markdown" or
point it at a file URI. The `convert_to_markdown` tool handles the rest.
