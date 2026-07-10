---
name: upstream-merge
description: Import specific upstream FerroxLabs/wayland commits into this independent fork via reviewed cherry-picks. Use when the user explicitly asks to pull in an upstream fix or commit. This fork no longer tracks upstream - if the user asks to "sync with upstream" or merge a release, push back and confirm they really want it.
---

# Upstream Import (cherry-pick only)

**This fork is independent.** As of the v0.11.17 divergence point we no longer
follow the original author's changes - see
[docs/contributing/fork-maintenance.md](../../../docs/contributing/fork-maintenance.md),
which is the authoritative inventory of fork-owned files, hook lines, and
independence guards. Read it before touching anything here.

Default posture: upstream ships something → we do **nothing**. Only import
when the user explicitly asks for a specific fix (e.g. a security patch in
code we still share), and import it as a cherry-pick, never a release merge.

## Procedure

1. **Confirm scope with the user.** Which commits, and why. If the request is
   "merge the new upstream version", stop and confirm - that contradicts the
   fork's independence policy and is almost never what's wanted anymore.

2. **Fetch and cherry-pick on a branch:**

   ```bash
   git remote add upstream https://github.com/FerroxLabs/wayland 2>/dev/null
   git fetch upstream
   git checkout -b upstream-import-<topic>
   git cherry-pick <sha> [<sha>...]
   ```

3. **Review the incoming diff like a third-party PR.** Upstream's direction is
   not trusted by default. Reject hunks that touch:
   - Fork-owned files (inventory in fork-maintenance.md): keep ours.
   - Hook files: keep the fork's hook lines intact.
   - **Independence surfaces** - `electron-builder.yml publish:`,
     `scripts/prepareWaylandCore.js` `GITHUB_OWNER`, or anything else that
     names a repo/URL: these must keep pointing at `dmercer290-byte/*`.
   - Locale JSON: union merge, then `bun run i18n:types` (never hand-merge
     the generated `i18n-keys.d.ts`).

4. **Verify** - all must pass before pushing:

   ```bash
   bun run test tests/unit/forkIntegrity.test.ts   # fork wiring + independence guards
   bun run test tests/unit/process/services/memory/ # transcript/memory suite
   bun run typecheck
   bun run test
   bun run i18n:types && node scripts/check-i18n.js # if locales changed
   ```

   If `forkIntegrity` fails, the failure message names the dropped hook or the
   re-tethered upstream reference - fix the code, don't delete the assertion.

5. If the import touches the engine, the engine fork
   (dmercer290-byte/wayland-core) has its own cherry-pick rules in its
   `REBRANDING.md` (rename protect-list, verification greps).

## Rules

- Never resolve a conflict by deleting a fork-owned file or hook line.
- Never let `FerroxLabs` back into the auto-update feed, engine download
  source, or any other build/release surface.
- New work during the import follows the "Keeping the codebase guarded" rules
  in fork-maintenance.md (new files + tiny hooks + a tripwire entry).
