---
name: upstream-merge
description: Merge an upstream FerroxLabs/wayland release into this fork without losing fork-owned features. Use when the user asks to update from upstream, sync with upstream, or merge a new upstream version, or invokes /upstream-merge.
---

# Upstream Merge

Merge an upstream release into this fork while preserving every fork feature.
The authoritative deviation inventory lives in
[docs/contributing/fork-maintenance.md](../../../docs/contributing/fork-maintenance.md) -
read it before resolving any conflict.

## Procedure

1. **Fetch the release.**

   ```bash
   git remote add upstream https://github.com/FerroxLabs/wayland 2>/dev/null
   git fetch upstream --tags
   ```

   Merge a **release tag** (e.g. `v0.11.18`), never upstream `main`.

2. **Merge on a branch.**

   ```bash
   git checkout -b upstream-merge-<version>
   git merge <release-tag>
   ```

3. **Resolve conflicts** using fork-maintenance.md:
   - **Fork-owned files** (listed there and in `tests/unit/forkIntegrity.test.ts`):
     keep ours. If upstream suddenly ships a file with the same path, upstream
     may have built its own version of the feature - diff both before choosing,
     and prefer retiring the fork copy if upstream's is equivalent.
   - **Hook files**: take upstream's new content, then re-apply the fork's
     hook lines (each is an import plus 1-5 lines; the inventory says exactly
     what goes where).
   - **Locale JSON**: union merge - keep both sides' keys. Then
     `bun run i18n:types` to regenerate `i18n-keys.d.ts` (never hand-merge the
     generated file).

4. **Verify** - all must pass before pushing:

   ```bash
   bun run test tests/unit/forkIntegrity.test.ts   # fork wiring tripwire
   bun run test tests/unit/process/services/memory/ # transcript/memory suite
   bun run typecheck
   bun run test
   bun run i18n:types && node scripts/check-i18n.js # if locales changed
   ```

   If `forkIntegrity` fails, the failure message names the dropped hook and
   the feature it wires up - re-apply it, don't delete the assertion.

5. **Record the new base**: update the "Current upstream base" line at the top
   of `docs/contributing/fork-maintenance.md` in the merge commit.

6. If the release bundles a new wayland-core version, the engine fork
   (dmercer290-byte/wayland-core) needs its own merge - follow `REBRANDING.md`
   in that repo.

## Rules

- Never resolve a conflict by deleting a fork-owned file or hook without
  checking the inventory first.
- If upstream superseded a fork feature, retire the fork version fully:
  remove files, hooks, tripwire entries, and the inventory section together.
- New fork features added during the merge window follow the "Keeping the
  fork mergeable" rules in fork-maintenance.md (new files + tiny hooks + a
  tripwire entry).
