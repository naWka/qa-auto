# Project rules for GitHub Copilot

Follow the same rules as in `CLAUDE.md` at the repository root (locators, assertions, waiting, structure).
In short:
- Locators: getByRole with a name → getByLabel → getByText / getByPlaceholder → getByTestId. No CSS classes, no XPath, no `.first()` to silence strict mode.
- Every test asserts the expected result from the test case with a web-first assertion (`await expect(...)`).
- No `page.waitForTimeout()`.
- Never change an expected value to make a test pass; if the app looks broken, mark the test `test.fixme()` with a comment and report it.
- One scenario = one independent test; page objects in `pages/`, assertions in the tests.
