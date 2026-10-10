import { test, expect } from '@playwright/test';

// Seed test for Playwright Test Agents: the planner and the generator start from here.
// It shows the agents where the app lives and which style our tests follow.
test('seed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fresh flowers, delivered with love' })).toBeVisible();
});
