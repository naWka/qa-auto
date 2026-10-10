# Emulator — supported Playwright for Python API

Student/AI code is written exactly like a real `tests/test_example.py` for **pytest + pytest-playwright**
(sync API). The emulator interprets a subset of Python in the browser and drives Bloomly in an iframe:

```python
import re
from playwright.sync_api import Page, expect


def test_registered_user_can_log_in(page: Page):
    page.goto("/login")
    page.get_by_label("Email").fill("anna@bloomly.app")
    page.get_by_label("Password").fill("bloom123")
    page.get_by_role("button", name="Log in").click()
    expect(page.get_by_role("heading", name="Welcome back, Anna!")).to_be_visible()
    expect(page).to_have_url(re.compile(r"/account"))
```

The `import` lines are optional in tasks (names like `expect`, `Page` still need them in real projects, so
prefer including them in full-file examples). Relative URLs work because the trainer runs pytest as if with
`--base-url http://localhost:3000` (see the starter's `pytest.ini`).

The test file is `test_example.py`. Other project files come from `files` (`pages/login_page.py`, `conftest.py`,
`data/users.json`, …) and are imported the Python way: `from pages.login_page import LoginPage`.

## Python subset

- Statements: assignment (incl. `a, b = …`, `*rest`, `+=`), `if/elif/else`, `for` (with `break`/`continue`/`else`),
  `while`, `def` (defaults, `*args`, `**kwargs`, keyword-only, type hints are parsed and ignored), `return`,
  `class` (inheritance, `super()`, `@property`, `@staticmethod`, `@classmethod`, `setup_method`/`teardown_method`),
  `with`, `try/except/else/finally`, `raise`, `assert` (pytest-style failure message), `import` / `from … import`,
  `global`, `nonlocal`, `del`, `pass`, `lambda`, `yield` (in fixtures; other generators are collected eagerly).
- Expressions: f-strings (with format specs: `{price:.2f}`, `{x!r}`, `{x=}`), list/dict/set comprehensions,
  conditional expressions, chained comparisons, `in`, `is`, slicing, `:=`.
- Types: `int`/`float` (one JS number: `5.0` prints as `5`), `str`, `bool`, `None`, `list`, `tuple`, `dict`, `set`.
  Common methods of `str`, `list`, `dict`, `set`.
- Built-ins: `print`, `len`, `str`, `int`, `float`, `bool`, `list`, `tuple`, `dict`, `set`, `range`, `enumerate`,
  `zip`, `sorted`, `reversed`, `sum`, `min`, `max`, `abs`, `round`, `any`, `all`, `map`, `filter`, `isinstance`,
  `hasattr`, `getattr`, `setattr`, `type`, `repr`, `open` (read-only, project files), `super`, exceptions.
- Modules: `pytest`, `playwright.sync_api`, `re`, `json`, `time`, `os` (`os.environ`, `os.getenv`, `os.path.join`),
  `random`, `uuid`, `math`, `datetime` (`date`, `datetime`, `timedelta`, `isoformat`, `strftime`), `dataclasses`
  (`@dataclass`, `field`), `typing` and `collections.abc` (names only), `logging` (prints).
  Anything else → `ModuleNotFoundError` (e.g. `requests`: in the trainer API tests use Playwright's request context).
- Errors are real Python errors with CPython wording: `NameError: name 'pag' is not defined`,
  `AttributeError: 'Page' object has no attribute 'getByRole'. Did you mean: 'get_by_role'?`,
  `TypeError: 'int' object is not callable`, `SyntaxError: '(' was never closed`, `IndentationError: …`,
  `SyntaxError: 'await' outside async function` (an AI that mixes up JS and Python).

## pytest

- Collection: module-level functions whose name starts with `test`, and methods `test*` of classes `Test*`
  (a class with `__init__` is skipped, like pytest does). `async def` tests are skipped
  ("async def functions are not natively supported").
- Fixtures: `@pytest.fixture` (also with `scope=`, `autouse=True`, `params=[…]`, `ids=`, `name=`), `yield` for
  teardown, fixtures requesting fixtures, `request.param`, `request.node.name`, `request.addfinalizer`,
  scopes `function` / `class` / `module` / `session` (one file = one session) with real `ScopeMismatch` errors,
  `conftest.py` from `files`.
- Built-in fixtures (pytest-playwright): `page`, `context` (`.request`, `.new_page()`, `.tracing`), `browser`,
  `browser_name` ("chromium"), `base_url` ("http://localhost:3000"), `playwright` (`.request.new_context(…)`),
  `request` (pytest's FixtureRequest), `browser_context_args`.
- Marks: `parametrize` (several, `ids=`, `pytest.param(…, id=…, marks=…)`), `skip`, `skipif`, `xfail`
  (`strict=True`), `usefixtures`, any custom marker (`smoke`, `regression` — accepted and ignored).
- `pytest.raises(…, match=…)`, `pytest.approx`, `pytest.skip()`, `pytest.fail()`, `pytest.xfail()`.
- Report: node ids like `test_example.py::TestLogin::test_ok[anna@bloomly.app]`, outcomes passed / failed /
  skipped / XFAIL / XPASS / ERROR (fixture setup or teardown failed), the failing line marked `>` and the error on
  `E` lines, captured `print()` output. Steps of each test (actions, assertions, fixture setup/teardown) are shown
  like a trace.

## Page (`page` fixture)

`goto(url)`, `url` (property!), `title()`, `reload()`, `go_back()`, `content()`,
`get_by_role(role, name=…, exact=…, checked=…, disabled=…, level=…, expanded=…, selected=…, pressed=…, include_hidden=…)`,
`get_by_text(text | re.compile(…), exact=…)`, `get_by_label`, `get_by_placeholder`, `get_by_test_id`,
`get_by_alt_text`, `get_by_title`, `locator(css | xpath)`, `wait_for_url(url | pattern)`,
`wait_for_timeout(ms)` (works, flagged as an anti-pattern), `wait_for_load_state()`, `keyboard.press(key)`,
`keyboard.type(text)`, `request` (API requests in the same context), `context`, `pause()`,
`click(selector)` / `fill(selector, value)` (discouraged shortcuts).

## Locator

Actions (auto-wait for attached + visible + enabled + receives pointer events):
`click()`, `dblclick()`, `fill(value)`, `clear()`, `press(key)`, `press_sequentially(text, delay=…)`, `check()`,
`uncheck()`, `set_checked(bool)`, `select_option(value | [values] | label=… | index=…)`, `hover()`, `focus()`.
Queries (no retry): `text_content()`, `inner_text()`, `input_value()`, `get_attribute(name)`, `is_visible()`,
`is_hidden()`, `is_enabled()`, `is_disabled()`, `is_checked()`, `is_editable()`, `count()`, `all()`,
`all_text_contents()`, `all_inner_texts()`, `wait_for(state=…)`.
Refinement: `first`, `last` (properties!), `nth(i)`, `filter(has_text=…, has_not_text=…, has=…, has_not=…, visible=…)`,
`locator(css | locator)`, chained `get_by_*`, `and_(…)`, `or_(…)`.
Strict mode: an action/assertion on a locator that matches 2+ elements raises
`Error: strict mode violation` with `aka` hints — exactly like Playwright.

## expect (playwright.sync_api)

`expect(locator | page | api_response, message=None)` — anything else raises
`ValueError: Unsupported type: <class 'int'>` (plain values are checked with `assert`).
Web-first, retrying until the timeout (5000 ms, `timeout=` option, `expect.set_options(timeout=…)`), each with a
`not_to_…` twin:
locator — `to_be_visible`, `to_be_hidden`, `to_be_enabled`, `to_be_disabled`, `to_be_checked`, `to_be_editable`,
`to_be_empty`, `to_be_focused`, `to_be_attached`, `to_be_in_viewport`, `to_have_text`, `to_contain_text`
(`use_inner_text=`, `ignore_case=`), `to_have_value`, `to_have_values`, `to_have_attribute(name, value)`,
`to_have_class`, `to_contain_class`, `to_have_id`, `to_have_count`;
page — `to_have_url`, `to_have_title`; API response — `to_be_ok`.
Failure messages follow Playwright for Python: `AssertionError: Locator expected to have text 'Welcome'`,
`Actual value: …`, `Call log: …`.

## API testing (fake Bloomly REST API)

`playwright.request.new_context(base_url="http://localhost:3000", extra_http_headers={…})` (usually in a fixture
with `yield` and `dispose()`), `page.request`, `context.request`:
`get/post/put/patch/delete/head/fetch(url, params=…, headers=…, data=…, form=…, fail_on_status_code=…)` →
`APIResponse` with **properties** `status`, `status_text`, `ok`, `url`, `headers` and **methods** `json()`
(dicts and lists), `text()`, `body()`.
Endpoints and responses: see docs/AUT.md "REST API". Within one test, API requests and `page` share one server
state (created orders/users and cancellations are visible in both). Note: in pytest `request` is pytest's own
fixture, so API fixtures get other names (`api`, `api_request_context`).

## Static analysis (review notes under the report and grading rules)

`hard-wait` (`wait_for_timeout`, `time.sleep`), `fragile-locator` (CSS/XPath in `locator()` or `page.click("…")`),
`no-assertion` (a test without `expect(…).to_…()` or `assert`), `weak-assertion` (`assert` on a one-off query like
`is_visible()`, `text_content()`, `count()` — no retry), `always-true` (`assert page.get_by_text("…")` — a locator
is always truthy), `not-called` (`page.reload`, `expect(x).to_be_visible` without `()` — nothing runs),
`no-matcher` (`expect(x)` alone). Grading rules: `hasAssertion`, `noHardWait`, `noFragile`, `callsMethods`,
`uses`, `notUses`, `regex`, `notRegex`, `minExpects` (counts matchers and `assert` statements).

## Trace viewer and inspector (simplified)

- `trace` steps/tasks run the test once and record a DOM snapshot before and after every action/assertion
  (the acted-on element is outlined). Panels: Actions, Before/After, Call, Errors, Console, Source. No network panel,
  no screenshots film strip. In real projects: `pytest --tracing retain-on-failure`, then
  `playwright show-trace test-results/…/trace.zip`.
- `inspect` steps/tasks show the live page with an Elements tree, an accessibility snapshot in the Playwright
  `aria_snapshot()` format with MCP-like `[ref=eN]` markers, and details of the selected element (attributes, role,
  accessible name and where it comes from, suggested locator in Python syntax).

## Simplifications (shown as "Emulator note")

- one browser (Chromium-like), one page per test, no parallel workers;
- timeouts: actions 5 s, assertions 5 s, test 20 s (real defaults: 30 s for actions and assertions-by-default 5 s,
  no test timeout unless pytest-timeout is used);
- one number type: `5.0` prints as `5`;
- accessible names are computed in a simplified way;
- no network interception, screenshots, video, `evaluate`; `sync_playwright()` / launching browsers by hand is not
  available (use the fixtures);
- `page.goto` only reaches the Bloomly app (`http://localhost:3000`).
