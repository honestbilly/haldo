/**
 * Haldo Crew App — Page smoke tests
 * Verifies each crew-facing page loads, renders key elements, and navigation works.
 */
import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('renders vessel name, weather, and daily logs', async ({ page }) => {
    await page.goto('/today');
    // Vessel name in hero
    await expect(page.locator('text=SQUID').first()).toBeVisible();
    // Weather strip — temp with degree symbol
    await expect(page.locator('text=/\\d+°/')).toBeVisible();
    // Daily Logs section
    await expect(page.getByText('DAILY LOGS')).toBeVisible();
    // Bottom nav
    await expect(page.locator('.nav-tab').filter({ hasText: 'Home' })).toBeVisible();
    await expect(page.locator('.nav-tab').filter({ hasText: 'Tasks' })).toBeVisible();
  });

  test('vessel pill is visible in header', async ({ page }) => {
    await page.goto('/today');
    const pill = page.locator('button').filter({ hasText: 'SQUID' }).first();
    await expect(pill).toBeVisible();
  });
});

test.describe('Task Queue', () => {
  test('loads and shows header', async ({ page }) => {
    await page.goto('/tasks/queue');
    await expect(page.getByText('Available Tasks')).toBeVisible();
    await expect(page.locator('text=SQUID').first()).toBeVisible();
    // Home back link
    await expect(page.locator('a').filter({ hasText: 'Home' }).first()).toBeVisible();
  });
});

test.describe('Task Detail', () => {
  test('renders full task layout with personnel and comments', async ({ page }) => {
    // Go to manager dashboard to find a task ID
    await page.goto('/report/tasks');
    await page.waitForLoadState('networkidle');

    const taskLink = page.locator('a[href*="/report/tasks/"]').filter({ hasNotText: /create|New/ }).first();
    const href = await taskLink.getAttribute('href');

    if (href) {
      const taskId = href.split('/report/tasks/')[1];
      await page.goto(`/tasks/${taskId}`);

      // Header — exact match to avoid "Tasks" in nav
      await expect(page.getByText('Task', { exact: true })).toBeVisible();
      // Main card with title
      await expect(page.locator('h2').first()).toBeVisible();
      // Info grid
      await expect(page.getByText('PRIORITY')).toBeVisible();
      await expect(page.getByText('VESSEL')).toBeVisible();
      // Personnel card
      await expect(page.getByText('PERSONNEL')).toBeVisible();
      // Comments section
      await expect(page.getByText('Comments')).toBeVisible();
      // Comment input
      await expect(page.getByPlaceholder('Add a note...')).toBeVisible();
    }
  });
});

test.describe('Weather Page', () => {
  test('renders current conditions and tides', async ({ page }) => {
    await page.goto('/weather');
    await expect(page.getByText('Weather & Tides')).toBeVisible();
    // Temperature — look for the big number
    await expect(page.locator('text=/\\d+°F/')).toBeVisible();
    // Wind — format is "11 kts ENE" or similar (first match)
    await expect(page.locator('text=/kts/').first()).toBeVisible();
    // Tides section header
    await expect(page.getByRole('heading', { name: /Tides/ })).toBeVisible();
    // Hourly section
    await expect(page.getByText('HOURLY FORECAST')).toBeVisible();
  });
});

test.describe('Submit Page', () => {
  test('renders category pills and form', async ({ page }) => {
    await page.goto('/submit');
    await expect(page.locator('h1').filter({ hasText: 'Submit' })).toBeVisible();
    // Category buttons
    await expect(page.locator('button').filter({ hasText: 'Maintenance' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Safety' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Suggestion' })).toBeVisible();
    // Form fields
    await expect(page.locator('input[name="title"]')).toBeVisible();
    await expect(page.locator('textarea[name="details"]')).toBeVisible();
  });

  test('category selection shows safety warning', async ({ page }) => {
    await page.goto('/submit');
    // Click Safety button
    await page.locator('button').filter({ hasText: 'Safety' }).click();
    // Safety warning should appear
    await expect(page.locator('#safety-warning')).toBeVisible();
  });
});

test.describe('More Page', () => {
  test('renders profile and menu items', async ({ page }) => {
    await page.goto('/more');
    await expect(page.locator('text=More').first()).toBeVisible();
    // Profile section — shows role text
    await expect(page.locator('text=/CAPTAIN|DECKHAND/i')).toBeVisible();
    // Menu items
    await expect(page.getByText('My Completions Today')).toBeVisible();
    await expect(page.getByText('Handoff Notes')).toBeVisible();
    await expect(page.getByText('MGMT Dashboard')).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('bottom nav tabs navigate correctly', async ({ page }) => {
    await page.goto('/today');

    // Use the .nav-tab class to target bottom nav links specifically
    await page.locator('.nav-tab').filter({ hasText: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/tasks\/queue/);

    await page.locator('.nav-tab').filter({ hasText: 'Weather' }).click();
    await expect(page).toHaveURL(/\/weather/);

    await page.locator('.nav-tab').filter({ hasText: 'Note' }).click();
    await expect(page).toHaveURL(/\/submit/);

    await page.locator('.nav-tab').filter({ hasText: 'More' }).click();
    await expect(page).toHaveURL(/\/more/);

    await page.locator('.nav-tab').filter({ hasText: 'Home' }).click();
    await expect(page).toHaveURL(/\/today/);
  });
});
