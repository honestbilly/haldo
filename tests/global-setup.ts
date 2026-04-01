/**
 * Global setup: creates a session by filling the vessel picker form.
 * Saves cookies to tests/.auth/session.json for reuse across tests.
 */
import { test as setup, expect } from '@playwright/test';

setup('create authenticated session', async ({ page }) => {
  // Clear any existing cookies first
  await page.context().clearCookies();

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Check if we got redirected to /today (already has session) — if so we need to log out first
  if (page.url().includes('/today')) {
    await page.goto('/logout');
    await page.waitForLoadState('networkidle');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  }

  // The no-auth flow: vessel buttons, date input, role buttons, crew select, submit
  // Select SQUID vessel
  const vesselBtns = page.locator('button, .select-btn');
  const squidBtn = vesselBtns.filter({ hasText: /squid/i }).first();
  await squidBtn.waitFor({ state: 'visible', timeout: 5000 });
  await squidBtn.click();

  // Select Captain role
  const captainBtn = vesselBtns.filter({ hasText: /captain/i }).first();
  await captainBtn.waitFor({ state: 'visible', timeout: 5000 });
  await captainBtn.click();

  // Select a crew member from dropdown
  const crewSelect = page.locator('select[name="crew_id"]');
  if (await crewSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    const options = await crewSelect.locator('option').all();
    for (const opt of options) {
      const val = await opt.getAttribute('value');
      if (val && val !== '' && val !== '__custom__') {
        await crewSelect.selectOption(val);
        break;
      }
    }
  }

  // Wait a beat for JS to enable the button, then submit
  await page.waitForTimeout(500);
  const submitBtn = page.locator('button[type="submit"]').first();
  await submitBtn.click({ force: true });

  // Wait for redirect to /today
  await page.waitForURL(/today/, { timeout: 10000 });
  await expect(page.locator('body')).toBeVisible();

  // Save storage state
  await page.context().storageState({ path: 'tests/.auth/session.json' });
});
