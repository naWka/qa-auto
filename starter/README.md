# Bloomly — Playwright regression suite

<!-- Replace the CI badge link with your repository: -->
<!-- ![Playwright Tests](https://github.com/<your-user>/<your-repo>/actions/workflows/playwright.yml/badge.svg) -->

Automated regression tests for **Bloomly**, a flower-delivery web app, built with
[Playwright Test](https://playwright.dev) together with an AI agent. I own the test design and the review;
the agent drafts plans and code.

## What is tested and why
<!-- Your test design: which scenarios, chosen by which risks. Example: -->
| Area | Scenarios | Why it matters |
|---|---|---|
| Login | valid login, wrong password, locked account | every purchase starts here |
| Cart | add, quantity, remove, promo codes, €50 free delivery | money is calculated here |
| … | … | … |

## How to run
Requirements: [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npx playwright install
npx playwright test          # runs headless; Bloomly starts automatically on http://localhost:3000
npx playwright test --ui     # UI mode: watch and debug
npx playwright show-report   # HTML report of the last run
```

Bloomly lives in `./app` (a static single-page app). To open it by hand: `npm run app`, then
http://localhost:3000. Switch on a known bug to see a test fail for the right reason:
http://localhost:3000/?bugs=greeting-wrong-name

## How I worked with the AI agent
<!-- Which agent (Claude Code / GitHub Copilot), Playwright MCP or CLI, Test Agents (planner/generator/healer). -->
<!-- What you rejected in review, which rules you added to CLAUDE.md, a flaky test you fixed, a bug a test caught. -->

## Project structure
```
app/                 Bloomly (the app under test)
tests/               test files (*.spec.js), seed.spec.js for the agents
pages/               page objects
specs/               Markdown test plans
CLAUDE.md            project rules for Claude Code
.github/             Copilot instructions and the GitHub Actions workflow
playwright.config.js baseURL, webServer, reporter, trace
```
