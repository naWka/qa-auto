// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Bloomly regression suite.
 * Docs: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    // Tests use relative paths: page.goto('/login')
    baseURL: 'http://localhost:3000',
    // Record a trace when a failed test is retried (open it from the HTML report)
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Cross-browser testing is one line each:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Starts Bloomly (the app in ./app) before the tests and stops it afterwards
  webServer: {
    command: 'npx serve -s app -l 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
