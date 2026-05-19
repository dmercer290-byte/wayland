/**
 * E2E (E4): Team-import D7 attack-vector coverage — 6 cases.
 *
 * Flow per E2E-TEST-PLAN §E4. Each case exercises the renderer-side import
 * path against a crafted fixture. The first three reject in the
 * `team.importPreview` pipeline (DOS / prototype-pollution / Zod regex) and
 * surface a Message.error toast without ever opening the modal. The fourth
 * passes preview but renders missingSpecialists in the modal and disables
 * both CTAs. The fifth exercises the prompt sanitizer; the sixth exercises
 * the cross-team mailbox MCP gate.
 *
 * Cases 5 + 6 carry honest gaps:
 *   • XSS task description — per W5 audit MED-2, the DOMPurify task-content
 *     wrap has no production caller yet. React text nodes already escape
 *     HTML on every rendered surface in v0.6.0, so there is no sink that
 *     would execute the script even if it slipped past the sanitizer.
 *     Marked test.fixme with the W5 MED-2 reference.
 *   • Cross-team mailbox attack — requires a live agent that can be told
 *     "message team B" and a way to observe the MCP gate rejection. The
 *     existing `mockAgentBinary` helper produces ACP frames but has no
 *     hook to inject the cross-team-message tool call, so the end-to-end
 *     attack cannot be staged without writing a new harness. Marked
 *     test.fixme with the harness gap.
 */

import path from 'path';
import { test, expect } from '../fixtures';
import { invokeBridge, navigateTo } from '../helpers';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/team-imports');

const FIX_OVERSIZE = path.join(FIXTURES_DIR, 'oversize.json');
const FIX_PROTOTYPE = path.join(FIXTURES_DIR, 'prototype-pollution.json');
const FIX_INVALID_ID = path.join(FIXTURES_DIR, 'invalid-skill-id.json');
const FIX_MISSING = path.join(FIXTURES_DIR, 'missing-specialist.json');

/**
 * Open /teams cleanly so each case starts from a known-good state. Single
 * boot is fine because none of these cases mutate persisted teams (they
 * all reject before any team is created).
 */
async function gotoTeamsPage(page: import('@playwright/test').Page): Promise<void> {
  await navigateTo(page, '#/teams');
  await page.waitForURL(/\/teams$/, { timeout: 15_000 });
}

async function selectImportFile(
  page: import('@playwright/test').Page,
  fixturePath: string
): Promise<void> {
  await page.locator('[data-testid="teams-import-cta"]').click();
  await page.locator('[data-testid="teams-import-file-input"]').setInputFiles(fixturePath);
}

// Arco Message renders into a global container. The exact text varies by
// rejection reason, but the toast role is always live (`aria-live="polite"`).
// We match by class as a fallback so locale variations don't blow up the
// assertion.
const TOAST_LOCATOR = '.arco-message';

test.describe.serial('Team import security — E4', () => {
  test('case 1: oversize file rejects with size error + no modal', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoTeamsPage(page);

    await selectImportFile(page, FIX_OVERSIZE);

    // Toast surfaces the safeParse error (TEAM_IMPORT_TOO_LARGE → message
    // "File exceeds 256KB" — the renderer prefixes "Failed to import team:").
    const toast = page.locator(TOAST_LOCATOR).filter({ hasText: /256\s*KB|too large|exceeds/i });
    await expect(toast.first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('[data-testid="capability-review-modal"]')).toHaveCount(0);
  });

  test('case 2: prototype-pollution payload rejects + no modal', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoTeamsPage(page);

    await selectImportFile(page, FIX_PROTOTYPE);

    const toast = page.locator(TOAST_LOCATOR).filter({ hasText: /prototype|__proto__/i });
    await expect(toast.first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('[data-testid="capability-review-modal"]')).toHaveCount(0);
  });

  test('case 3: invalid skill-id ("../../malicious") rejects + no modal', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoTeamsPage(page);

    await selectImportFile(page, FIX_INVALID_ID);

    // Zod regex failure surfaces via TEAM_IMPORT_SCHEMA_INVALID. The Zod
    // message text references the regex path (`leader.id`) so we match on
    // that or the generic "Invalid team export" prefix.
    const toast = page.locator(TOAST_LOCATOR).filter({ hasText: /Invalid|leader\.id|skill/i });
    await expect(toast.first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('[data-testid="capability-review-modal"]')).toHaveCount(0);
  });

  test('case 4: missing specialist opens modal with both CTAs disabled', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoTeamsPage(page);

    await selectImportFile(page, FIX_MISSING);

    // Preview succeeds (the response carries `missingSpecialists`), so the
    // modal opens — but both action CTAs are disabled and the warning alert
    // explains what is missing.
    const modal = page.locator('[data-testid="capability-review-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('[data-testid="capability-review-missing-specialists"]')).toBeVisible();
    await expect(page.locator('[data-testid="capability-review-trust"]')).toBeDisabled();
    await expect(page.locator('[data-testid="capability-review-sandbox"]')).toBeDisabled();

    // Cancel so subsequent serial-suite cases start from /teams cleanly.
    await page.locator('[data-testid="capability-review-cancel"]').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
  });

  test('case 5: XSS in task description must not fire alert (sanitizer gate)', async ({ page }) => {
    // Per W5 audit MED-2: the prompt sanitizer is implemented in
    // `src/process/team/promptSanitizer.ts` but has NO production caller in
    // v0.6.0 — every renderer surface that shows task content uses React
    // text nodes (which escape HTML by default), so there is no sink that
    // could execute the script even if it bypassed the sanitizer. Without
    // a render path that could ever execute the script in the first place,
    // there is no negative assertion to make.
    test.fixme(
      true,
      'awaiting v0.6.1 task-tab render sink — sanitizer has no production caller per W5 MED-2'
    );

    void page;
  });

  test('case 6: cross-team mailbox attack must be MCP-rejected', async ({ page }) => {
    // Cross-team-message MCP gate is enforced in TeamSessionService /
    // mailbox routing; reproducing the attack end-to-end requires:
    //   1. A running sandboxed agent on team A
    //   2. The ability to inject a deterministic "message team B" tool
    //      call into that agent's outbound stream
    //   3. A way to observe the MCP gate's rejection (event log entry or
    //      log line) without depending on a real LLM response.
    // Helper `mockAgentBinary` produces ACP frames for AcpHandler but has
    // no hook for staging the cross-team tool call; adding one is a new
    // harness, not a one-line change. Marked fixme so the gate is tracked
    // explicitly rather than silently skipped.
    test.fixme(
      true,
      'no mockAgentBinary hook stages cross-team-message tool calls; ' +
        'requires a new MCP-aware mock harness (queued for v0.6.1)'
    );

    void page;
  });
});
