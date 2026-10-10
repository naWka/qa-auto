# Project rules for GitHub Copilot

Follow the same rules as in `CLAUDE.md` at the repository root (Python, locators, assertions, waiting, structure).
In short:
- Python + pytest + pytest-playwright, sync API: `from playwright.sync_api import Page, expect`, snake_case,
  keyword arguments (`name="Log in"`), no `await` / `async`, no JavaScript habits (`getByRole`, `{ name: ... }`).
- Locators: `get_by_role` with a name → `get_by_label` → `get_by_text` / `get_by_placeholder` → `get_by_test_id`.
  No CSS classes, no XPath, no `.first` / `.nth()` to silence strict mode — use `.filter(has_text="…")`.
- Every test checks the expected result from the test case with `expect()` (web-first). Never `assert locator.is_visible()`
  or `assert locator`; call methods with brackets (`to_be_visible()`).
- No `page.wait_for_timeout()`, no `time.sleep()`.
- Test names read like test-case titles: `def test_expired_promo_code_is_rejected(page: Page):`.
- Never change an expected value to make a test pass; if the app looks broken, mark the test
  `@pytest.mark.xfail(reason="…")` and report it.
- One scenario = one independent test in `tests/test_<feature>.py`; page objects in `pages/`, shared fixtures
  (`logged_in_page`) in `conftest.py`, assertions in the tests.
- Run `pytest` after every change and report the result honestly, quoting the `E` lines of failures.
