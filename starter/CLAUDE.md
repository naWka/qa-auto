# Project rules for AI agents (Claude Code reads this file at the start of every session)

This repository is a regression suite for Bloomly, a flower-delivery web app, written in **Python** with
**pytest** and **pytest-playwright** (sync API). The app lives in `./app`; pytest starts it on
http://localhost:3000 by itself (`conftest.py`). To open it by hand: `python serve_app.py`.

## How we work
- A human QA engineer owns the test design. Write tests only for scenarios from `specs/` or from the prompt.
- Before writing a locator, open the live page (Playwright MCP / Playwright CLI snapshot) — never guess names.
- Keep changes small. Run `pytest` after every change (`.venv` activated), read its output and report the
  result honestly: which tests passed, which failed, and the `E` lines of every failure.
- This is a Python project: `from playwright.sync_api import Page, expect`, snake_case methods, keyword
  arguments (`name="Log in"`), no `await` / `async`. Never JavaScript habits like `getByRole`, `{ name: ... }`,
  `true` / `null`.
- Don't add packages without asking; if one is really needed, add it to `requirements.txt`.

## Locators
- `get_by_role` with a name, then `get_by_label`, then `get_by_text` / `get_by_placeholder`, then `get_by_test_id`.
- No CSS classes, no `nth-child`, no XPath. No `.first` / `.nth()` to silence strict mode — filter instead:
  `page.get_by_test_id("product-card").filter(has_text="Sunny Tulips").get_by_role("button", name="Add to cart")`.

## Assertions
- Every test checks the expected result from the test case with `expect()` — exact text, value, count or URL.
- Web-first assertions only: `expect(locator).to_have_text("…")`, `expect(page).to_have_url("…")`.
  Never `assert locator.is_visible()` (checks once, no retry) and never `assert locator` (always true).
  Call every method with brackets: `to_be_visible()`, not `to_be_visible`.
- Never change an expected value just to make a test pass. If the app looks broken, stop and say so:
  mark the test `@pytest.mark.xfail(reason="…what you saw…")` — a human decides whether it's a bug.

## Waiting
- No `page.wait_for_timeout()` and no `time.sleep()`. Wait for what the user waits for with a web-first assertion.

## Structure
- Test files: `tests/test_<feature>.py`. One scenario = one independent test function. Every test gets a fresh
  browser context from the `page` fixture — don't rely on other tests or on their order.
- Test names read like test-case titles: `def test_expired_promo_code_is_rejected(page: Page):`.
- Short paths only: `page.goto("/cart")` — the base URL lives in `pytest.ini`.
- Page objects live in `pages/` (`pages/login_page.py`: locators in `__init__`, actions as methods);
  assertions stay in the tests.
- Shared fixtures live in `conftest.py`. "User is logged in" = the `logged_in_page` fixture.
- Mark the most important happy paths `@pytest.mark.smoke`.
