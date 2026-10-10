# Bloomly — Playwright regression suite

<!-- Replace the CI badge link with your repository: -->
<!-- ![Playwright Tests](https://github.com/<your-user>/<your-repo>/actions/workflows/playwright.yml/badge.svg) -->

Automated regression tests for **Bloomly**, a flower-delivery web app, written in Python with
[pytest](https://docs.pytest.org) and [Playwright for Python](https://playwright.dev/python/) together with an
AI agent. I own the test design and the review; the agent drafts plans and code.

## What is tested and why
<!-- Your test design: which scenarios, chosen by which risks. Example: -->
| Area | Scenarios | Why it matters |
|---|---|---|
| Login | valid login, wrong password, locked account | every purchase starts here |
| Cart | add, quantity, remove, promo codes, €50 free delivery | money is calculated here |
| … | … | … |

## Setup (once)
Requirements: [Python](https://www.python.org/downloads/) 3.10 or newer. Open a terminal in this folder.

1. Create a virtual environment — a private set of packages for this project, so nothing clashes with other
   Python projects on your computer:
   ```bash
   python -m venv .venv
   ```
   On macOS the command may be called `python3`; once the environment is active, plain `python` works.
2. Activate it — **every time** you open a new terminal for this project:
   ```bash
   source .venv/bin/activate      # macOS / Linux
   .venv\Scripts\activate         # Windows
   ```
   The prompt now starts with `(.venv)`. (If Windows PowerShell refuses to run the script, use Command Prompt.)
3. Install pytest, Playwright and the browsers:
   ```bash
   pip install -r requirements.txt
   playwright install
   ```

## Running the tests
```bash
pytest                         # all tests, headless; Bloomly starts by itself on http://localhost:3000
pytest -v                      # one line per test: PASSED / FAILED
pytest --headed                # watch the browser do the steps
pytest -k login                # only tests with "login" in the name
pytest -m smoke                # only tests marked @pytest.mark.smoke
pytest tests/test_login.py::test_wrong_password_shows_an_error     # one test
pytest --html=report.html --self-contained-html                    # plus an HTML report (pytest-html)
```

Settings live in `pytest.ini`: the base URL (tests write `page.goto("/login")`), traces for failed tests and the
`smoke` marker. Shared fixtures, like `logged_in_page` and the one that starts Bloomly, live in `conftest.py`.

## Bloomly, the app under test
Bloomly lives in `./app` (a static single-page app). pytest starts it for the test run. To click around by hand,
record with codegen or let an agent explore it, start it in a separate terminal and leave it running:
```bash
python serve_app.py            # then open http://localhost:3000
```
Switch on a known bug to see a test fail for the right reason:
http://localhost:3000/?bugs=greeting-wrong-name (it stays on until you close the browser tab).
`python -m http.server` won't do here: it answers 404 for addresses like `/login` — `serve_app.py` explains why.

## When a test fails
1. Read pytest's output: the failing line is marked with `>`, the error is on the `E` lines below it,
   and `short test summary info` lists every failed test.
2. Open the trace — a step-by-step recording with a snapshot of the page before and after every action.
   pytest keeps one for every failed test in `test-results/`, in a folder named after the test:
   ```bash
   playwright show-trace test-results/tests-test-login-py-test-wrong-password-shows-an-error-chromium/trace.zip
   ```
   You can also drop a `trace.zip` onto https://trace.playwright.dev.
3. Step through a test with the Playwright Inspector (it also has "Pick locator"):
   `PWDEBUG=1 pytest -s -k wrong_password` (Windows Command Prompt: `set PWDEBUG=1`, then `pytest -s -k wrong_password`).

## Recording a draft with codegen
With Bloomly running (`python serve_app.py`):
```bash
playwright codegen --target python-pytest http://localhost:3000
```
Click through the scenario; Playwright writes a pytest test as you go. It's a draft: add the expected results with
`expect()`, give the test a name that reads like the test case, and check the locators against the rules in `CLAUDE.md`.

## Working with an AI agent
- **Claude Code** reads `CLAUDE.md` at the start of every session; **GitHub Copilot** in VS Code reads
  `.github/copilot-instructions.md`. Both hold the same project rules — when you catch the agent doing something
  you don't want, add a rule there.
- **Playwright MCP** lets the agent open Bloomly in a real browser and read the page's accessibility snapshot
  instead of guessing locators. It runs on [Node.js](https://nodejs.org) (LTS), so install Node once — only for
  MCP and the CLI, the tests themselves don't need it.
  ```bash
  claude mcp add playwright npx @playwright/mcp@latest                                  # Claude Code
  code --add-mcp '{"name":"playwright","command":"npx","args":["@playwright/mcp@latest"]}'   # VS Code + Copilot
  ```
  The Playwright CLI (`@playwright/cli`, command `playwright-cli`) does the same job with fewer tokens.
- Keep Bloomly running (`python serve_app.py`) while the agent explores it.
- Plans go to `specs/`, tests to `tests/`. How the planner → generator → healer loop works in a Python project:
  [specs/README.md](specs/README.md). The seed test `tests/test_seed.py` is where agents start.

## Publishing to GitHub
1. Create an empty repository on GitHub (no README, no .gitignore — this folder has them).
2. In this folder:
   ```bash
   git init
   git add .
   git commit -m "Bloomly regression suite"
   git branch -M main
   git remote add origin https://github.com/<your-user>/<your-repo>.git
   git push -u origin main
   ```
   `.gitignore` keeps `.venv/`, caches and test results out of the repository.
3. Open the **Actions** tab: `.github/workflows/playwright.yml` runs all tests on every push and pull request.
   When a run fails, download the `playwright-traces` artifact and open the trace with `playwright show-trace`.
4. Put the CI badge at the top of this README (see the comment there) and fill in the sections about your work.

## How I worked with the AI agent
<!-- Which agent (Claude Code / GitHub Copilot), Playwright MCP or CLI, your planner/generator/healer prompts. -->
<!-- What you rejected in review, which rules you added to CLAUDE.md, a flaky test you fixed, a bug a test caught. -->

## Project structure
```
app/                 Bloomly (the app under test)
tests/               test files: test_login.py, test_seed.py (the starting point for agents)
pages/               page objects (login_page.py)
specs/               Markdown test plans
conftest.py          shared fixtures: starts Bloomly, logged_in_page
pytest.ini           base URL, traces, markers
requirements.txt     Python packages (pytest, pytest-playwright, pytest-html)
serve_app.py         serves Bloomly on http://localhost:3000
CLAUDE.md            project rules for Claude Code
.github/             Copilot instructions and the GitHub Actions workflow
```
