# Project rules for AI agents (Claude Code reads this file at the start of every session)

This repository is a Playwright Test regression suite for Bloomly, a flower-delivery web app.
The app lives in `./app` and is started by `webServer` in `playwright.config.js` (http://localhost:3000).

## How we work
- A human QA engineer owns the test design. Write tests only for scenarios from `specs/` or from the prompt.
- Before writing a locator, open the live page (Playwright MCP / Playwright CLI snapshot) — never guess names.
- Keep changes small; run `npx playwright test` after every change and report the result honestly.

## Locators
- Use `getByRole` with a name, then `getByLabel`, then `getByText` / `getByPlaceholder`, then `getByTestId`.
- No CSS classes, no `nth-child`, no XPath. No `.first()` / `.nth()` to silence strict mode — filter instead:
  `page.getByTestId('product-card').filter({ hasText: 'Sunny Tulips' }).getByRole('button', { name: 'Add to cart' })`.

## Assertions
- Every test asserts the expected result from the test case — exact text, value, count or URL.
- Use web-first assertions: `await expect(locator).toHaveText(...)`, never `expect(await locator.isVisible()).toBeTruthy()`.
- Never change an expected value just to make a test pass. If the app looks broken, stop and say so
  (mark the test `test.fixme()` with a comment) — a human decides whether it's a bug.

## Waiting
- No `page.waitForTimeout()`. Wait for what the user waits for with a web-first assertion.

## Structure
- One scenario = one independent test. Every test gets a fresh browser context; don't rely on other tests.
- Page objects live in `pages/`; assertions stay in the tests.
- Test titles are short, in English, and describe the behavior: `'expired promo code is rejected'`.
