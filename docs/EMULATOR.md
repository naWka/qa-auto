# Emulator — supported Playwright API

Student/AI code is written exactly like a real `example.spec.js` file:

```js
import { test, expect } from '@playwright/test';

test('user can log in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('anna@bloomly.app');
  await page.getByLabel('Password').fill('bloom123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Anna!' })).toBeVisible();
});
```

The `import` line is optional in tasks (the emulator provides `test`/`expect` anyway), but
prefer including it in full-file examples so the code works unchanged in real Playwright.

## Test runner
- `test(title, fn)`, `test.only`, `test.skip(title, fn)`, `test.fixme`
- `test.describe(title, fn)`, `test.beforeEach`, `test.afterEach`, `test.beforeAll`, `test.afterAll`
- `test.step(title, fn)`, `test.extend({ ... })` (fixtures)
- fixtures: `page`, `request`, `baseURL` ("http://localhost:3000"), `browserName` ("chromium")
- each test gets a fresh page/context (isolation)
- `console.log` output is shown in the report

## page
`goto(url)`, `url()`, `title()`, `reload()`, `goBack()`,
`getByRole(role, { name, exact, checked, disabled, level, includeHidden })`,
`getByText(text | RegExp, { exact })`, `getByLabel`, `getByPlaceholder`, `getByTestId`, `getByAltText`, `getByTitle`,
`locator(css)`, `waitForURL(url | RegExp)`, `waitForTimeout(ms)` (works, flagged as anti-pattern),
`waitForLoadState()`, `keyboard.press(key)`.

## Locator
Actions (auto-wait for attached + visible + enabled + receives pointer events):
`click()`, `dblclick()`, `fill(value)`, `clear()`, `press(key)`, `pressSequentially(text)`, `check()`, `uncheck()`,
`setChecked(bool)`, `selectOption(value | label | { label } | { index })`, `hover()`, `focus()`.
Queries: `textContent()`, `innerText()`, `inputValue()`, `getAttribute(name)`, `isVisible()`, `isHidden()`,
`isEnabled()`, `isDisabled()`, `isChecked()`, `count()`, `all()`, `allTextContents()`, `allInnerTexts()`,
`waitFor({ state })`.
Refinement: `first()`, `last()`, `nth(i)`, `filter({ hasText, hasNotText, has, hasNot })`, `locator(css)`,
chained `getBy*`, `and()`, `or()`.
Strict mode: an action/assertion on a locator that matches 2+ elements throws
`strict mode violation` — exactly like Playwright.

## expect
Web-first (retry until timeout, default 5000 ms, `{ timeout }` option, `.not` supported):
`toBeVisible`, `toBeHidden`, `toBeEnabled`, `toBeDisabled`, `toBeChecked`, `toBeEditable`, `toBeEmpty`,
`toBeFocused`, `toBeAttached`, `toHaveText`, `toContainText`, `toHaveValue`, `toHaveAttribute`,
`toHaveClass`, `toHaveCount`, `toHaveId`; page: `toHaveURL`, `toHaveTitle`; API response: `toBeOK`.
Generic (no retry): `toBe`, `toEqual`, `toStrictEqual`, `toBeTruthy`, `toBeFalsy`, `toBeNull`,
`toBeUndefined`, `toBeDefined`, `toContain`, `toHaveLength`, `toMatch`, `toBeGreaterThan(OrEqual)`,
`toBeLessThan(OrEqual)`, `toHaveProperty`, `toMatchObject`, `toBeCloseTo`.
`expect.soft(...)` supported.

## request (fake Bloomly REST API)
`request.get/post/put/patch/delete(url, { data, params, headers })` → `status()`, `ok()`, `json()`, `text()`, `headers()`.
Endpoints and responses: see docs/AUT.md "REST API". Within one test, `request` and `page` share one server state
(created orders/users and cancellations are visible in both).

## Virtual files
Tasks can ship extra files next to the spec (`files: { 'pages/LoginPage.js': '…' }`); the spec imports them with
`import { LoginPage } from './pages/LoginPage';`. Files are plain JavaScript modules (`export class …`, `export const …`,
`export function …`); TypeScript type annotations are not supported. A fixtures file can re-export an extended test:
`export const test = base.extend({ … }); export { expect } from '@playwright/test';` → `import { test, expect } from './fixtures';`.

## Trace viewer and inspector (simplified)
- `trace` steps/tasks run the test once and record a DOM snapshot before and after every action/assertion
  (the acted-on element is outlined). Panels: Actions, Before/After, Call, Errors, Console, Source. No network panel,
  no screenshots film strip.
- `inspect` steps/tasks show the live page with an Elements tree, an accessibility snapshot in the Playwright
  `ariaSnapshot()` format with MCP-like `[ref=eN]` markers, and details of the selected element (attributes, role,
  accessible name and where it comes from, suggested locator).

## Simplifications (shown as "Emulator note")
- one browser (Chromium-like), no `projects`, no parallel workers;
- timeouts: actions 5 s, assertions 5 s, test 20 s (real defaults: test 30 s, actions unlimited);
- accessible names are computed in a simplified way;
- no network interception, screenshots, video; the trace viewer is a simplified DOM-snapshot version;
- `page.goto` only reaches the Bloomly app (`http://localhost:3000`);
- a test that forgets `await` is reported explicitly (real Playwright may silently pass or fail randomly).
