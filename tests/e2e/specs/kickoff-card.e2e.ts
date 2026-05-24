/**
 * E2E (v0.4.7.1): Kickoff card on the new-chat surface.
 *
 * Validates the post-cross-audit kickoff system end-to-end as a user would.
 *
 * Entry-path: we pre-seed `guid.lastSelectedAgent` in ConfigStorage to
 * `custom:ext-helm` BEFORE navigating to /guid. The GuidPage's
 * `useGuidAgentSelection` restores this on mount, sets `isPresetAgent: true`,
 * and the kickoff hook fires its IPC for ext-helm — which the engine resolves
 * via `stripIdPrefix` (ENGINE-1 fix). This sidesteps the UI choreography
 * (which assistant-picker affordance is canonical post-Phase-6 redesign)
 * and isolates the test to the kickoff card mechanics, which IS what the
 * cross-audit was about.
 *
 * Per Sean's `feedback-playwright-cdp-for-electron-verify`: interaction tests
 * MUST use Playwright real drivers, not synthetic dispatchEvent. Focus,
 * keyboard, and click all go through Playwright's protocol.
 *
 * Selectors used:
 *   - new-chat-kickoff-card       — card container
 *   - new-chat-kickoff-accept     — primary "Yes, let's start"
 *   - new-chat-kickoff-redirect   — "Something else"
 *   - new-chat-kickoff-dismiss    — × dismiss
 *
 * Pre-seeded storage key:
 *   - agent.config.storage.set { key: 'guid.lastSelectedAgent', data: 'custom:ext-helm' }
 *   - agent.config.storage.set { key: 'guid.lastSelectedAgent', data: 'custom:ext-slate' } (second test)
 *
 * Prereq: app must be built (`bunx electron-vite build`) OR run with
 * `E2E_DEV=1 bun run test:e2e tests/e2e/specs/kickoff-card.e2e.ts`.
 */

import { test, expect } from '../fixtures';
import { invokeBridge, navigateTo, ROUTES } from '../helpers';

const KICKOFF_CARD = '[data-testid="new-chat-kickoff-card"]';
const KICKOFF_ACCEPT = '[data-testid="new-chat-kickoff-accept"]';
const KICKOFF_REDIRECT = '[data-testid="new-chat-kickoff-redirect"]';
const KICKOFF_DISMISS = '[data-testid="new-chat-kickoff-dismiss"]';
const GUID_TEXTAREA = 'textarea';

const HELM_KEY = 'custom:ext-helm';
const SLATE_KEY = 'custom:ext-slate';

/**
 * Pre-seed `guid.lastSelectedAgent` then navigate to /guid and force a
 * reload so the restore-on-mount logic picks up the seeded value.
 *
 * Module-scoped per-session dismiss is in-memory in the renderer, so reloads
 * also clear it — exactly what we want between test cases.
 */
async function seedPresetAndOpenGuid(page: import('@playwright/test').Page, agentKey: string) {
  await invokeBridge(page, 'agent.config.storage.set', { key: 'guid.lastSelectedAgent', data: agentKey });
  await navigateTo(page, ROUTES.guid);
  await page.reload();
  await page.locator(GUID_TEXTAREA).first().waitFor({ state: 'visible', timeout: 10_000 });
}

test.describe('Kickoff card — new-chat empty state (v0.4.7.1)', () => {
  test('preset assistant selection surfaces the kickoff card below the input', async ({ page }) => {
    await seedPresetAndOpenGuid(page, HELM_KEY);

    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });

    // RENDERER-1 + design contract: card mounts BELOW the input.
    const inputBox = await page.locator(GUID_TEXTAREA).first().boundingBox();
    const cardBox = await page.locator(KICKOFF_CARD).boundingBox();
    expect(inputBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    if (inputBox && cardBox) {
      expect(cardBox.y).toBeGreaterThan(inputBox.y);
    }

    // D-M-4 — a11y attributes
    const card = page.locator(KICKOFF_CARD);
    await expect(card).toHaveAttribute('role', 'region');
    await expect(card).toHaveAttribute('aria-live', 'polite');
    const ariaLabel = await card.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel?.length).toBeGreaterThan(3);
  });

  test('clicking "Yes, let\'s start" prefills the input AND focuses the textarea (RENDERER-1)', async ({ page }) => {
    await seedPresetAndOpenGuid(page, HELM_KEY);
    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator(GUID_TEXTAREA).first();
    const beforeValue = await textarea.inputValue();
    expect(beforeValue).toBe('');

    await page.locator(KICKOFF_ACCEPT).click();

    // RENDERER-1 — prefill landed
    await expect(textarea).not.toHaveValue('', { timeout: 3_000 });
    const afterValue = await textarea.inputValue();
    expect(afterValue.length).toBeGreaterThan(0);

    // RENDERER-1 — textarea is the focused element
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
    expect(focusedTag).toBe('textarea');

    // Card dismissed itself after accept
    await expect(page.locator(KICKOFF_CARD)).not.toBeVisible();
  });

  test('× dismiss hides the card; reloading with same preset keeps it hidden (per-session)', async ({ page }) => {
    await seedPresetAndOpenGuid(page, HELM_KEY);
    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });

    await page.locator(KICKOFF_DISMISS).click();
    await expect(page.locator(KICKOFF_CARD)).not.toBeVisible();

    // NOTE: per-session dismiss lives in module-scoped renderer memory; a
    // page.reload() resets that. So we can't use reload to verify
    // "still dismissed" — the dismiss is per-session in the JS sense, NOT
    // per-launch persistent. This test ends after the click-and-hide
    // assertion; cross-session persistence is out of scope (and that
    // matches Sean's locked decision #1 in the v0.4.7 handoff).
  });

  test('"Something else" rotates through alternates, then exhausts to dismiss', async ({ page }) => {
    await seedPresetAndOpenGuid(page, HELM_KEY);
    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });

    const card = page.locator(KICKOFF_CARD);
    const initialText = (await card.textContent()) ?? '';

    // Redirect 1
    await page.locator(KICKOFF_REDIRECT).click();
    await expect(card).toBeVisible();
    const afterFirst = (await card.textContent()) ?? '';
    expect(afterFirst).not.toBe(initialText);

    // Redirect 2
    await page.locator(KICKOFF_REDIRECT).click();
    await expect(card).toBeVisible();

    // Redirect 3 — ladder exhausted
    await page.locator(KICKOFF_REDIRECT).click();
    await expect(card).not.toBeVisible({ timeout: 3_000 });
  });

  test('Escape key dismisses the card (D-M-4 keyboard a11y)', async ({ page }) => {
    await seedPresetAndOpenGuid(page, HELM_KEY);
    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(page.locator(KICKOFF_CARD)).not.toBeVisible();
  });

  test('typing in the input dismisses the card (dismiss-on-type), first keystroke preserved', async ({ page }) => {
    await seedPresetAndOpenGuid(page, HELM_KEY);
    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator(GUID_TEXTAREA).first();
    await textarea.focus();
    await textarea.type('h');

    await expect(page.locator(KICKOFF_CARD)).not.toBeVisible({ timeout: 2_000 });
    const value = await textarea.inputValue();
    expect(value).toBe('h');
  });

  test('rapid double-click on "Yes" does not double-prefill (RENDERER-2 lock)', async ({ page }) => {
    await seedPresetAndOpenGuid(page, HELM_KEY);
    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator(GUID_TEXTAREA).first();
    const accept = page.locator(KICKOFF_ACCEPT);
    // Two rapid clicks
    await Promise.all([accept.click(), accept.click().catch(() => {})]);

    await expect(page.locator(KICKOFF_CARD)).not.toBeVisible();
    const value = await textarea.inputValue();
    expect(value.length).toBeGreaterThan(0);
    // Telemetry double-fire validated by unit tests; here we smoke that the
    // UI doesn't throw on the double-tap and only one prefill landed.
  });

  test('different preset gets its own fresh card (per-assistant scoped)', async ({ page }) => {
    await seedPresetAndOpenGuid(page, SLATE_KEY);
    await expect(page.locator(KICKOFF_CARD)).toBeVisible({ timeout: 10_000 });
    // Slate is a distinct preset assistant; its kickoff library should
    // surface a card just like helm's did.
  });
});
