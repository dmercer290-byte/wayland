# Third-party notices

Wayland is built on, and includes substantial source code from, the following Apache-2.0
licensed project. This notice satisfies the attribution requirement of the Apache License,
Version 2.0, Section 4(c).

## AionUi

- **Project:** AionUi (aionui.com)
- **Source:** https://github.com/iOfficeAI/AionUi
- **License:** Apache License, Version 2.0
- **Copyright:** Copyright 2025 AionUi (aionui.com)
- **Use in Wayland:** Wayland is a derivative work of AionUi. The original AionUi source
  forms the foundation of the Wayland application: the Electron main process, IPC bridge,
  renderer UI scaffolding, agent client protocol integration, MCP services, and the
  multi-CLI cowork architecture all originate from AionUi.

Per the Apache 2.0 License, Section 4(b), files modified by Wayland carry no removal of
the original copyright notices. The full Apache License is included as `LICENSE` at the
root of this repository.

## aionrs

- **Project:** aionrs
- **Source:** https://github.com/iOfficeAI/aionrs
- **License:** Apache License, Version 2.0
- **Use in Wayland:** Wayland integrates `aionrs` as an external, unmodified upstream
  dependency. Source code under `src/process/agent/aionrs/`, `scripts/prepareAionrs.js`,
  and related integration points references `aionrs` as a third-party package and is
  intentionally left under its original naming to preserve interoperability.

---

### How to update this file

When Wayland adds, removes, or substantially modifies its dependency on an Apache-2.0
or similarly attribution-required upstream, edit this file. Do not edit `LICENSE` —
that is the canonical license text and must remain unchanged.
