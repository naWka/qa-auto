# Test plans

Markdown test plans live here — written by you or drafted by an AI agent, and always reviewed by you.
One file per feature, for example `specs/cart.md`: numbered scenarios, steps, expected results.

```markdown
# Cart

Start: tests/test_seed.py, then http://localhost:3000/shop

## 1. Adding a product updates the cart count
Steps:
1. Open /shop.
2. Click "Add to cart" on the "Sunny Tulips" card.
Expected: the message "Sunny Tulips added to cart" appears; the cart count in the menu shows 1.
```

## Planner → generator → healer in a Python project

Playwright's ready-made Test Agents (`npx playwright init-agents`) write JavaScript/TypeScript tests only.
In this project the same three roles are played by your own agent — Claude Code or GitHub Copilot — with
Playwright MCP (or the Playwright CLI) to see the live page and `pytest` to run the tests:

1. **Planner.** The agent runs `tests/test_seed.py`, opens Bloomly through Playwright MCP, explores one feature
   and writes a plan to `specs/<feature>.md`. **You review the plan:** are the risks covered — boundaries,
   negative cases, the €50 free-delivery threshold? Add what's missing, delete what doesn't matter.
2. **Generator.** The agent turns the reviewed plan into `tests/test_<feature>.py`, checking every locator on the
   live page, and runs `pytest`. **You review the code:** do the steps match the plan, does every test check
   the expected result with `expect()`, do the rules in `CLAUDE.md` hold?
3. **Healer.** When a test fails, the agent reads pytest's output and the trace (`test-results/…/trace.zip`),
   opens the page again and proposes a fix. **You decide:** the app changed on purpose → fix the test;
   the app is broken → the test stays red (or `@pytest.mark.xfail(reason="BUG-…")`) and you report the bug.

Prompts to start with:

- Planner: *"Run tests/test_seed.py. Then open http://localhost:3000/cart through Playwright MCP and explore the cart:
  quantities, removing items, promo codes, delivery. Write a test plan to specs/cart.md: numbered scenarios with steps
  and exact expected results. Don't write any code yet."*
- Generator: *"Write tests for scenarios 1–4 of specs/cart.md in tests/test_cart.py, following CLAUDE.md. Check every
  locator on the live page. Run pytest and show me the result."*
- Healer: *"tests/test_cart.py::test_promo_code_gives_10_percent_off fails. Read the pytest output and the trace, open
  the page, and tell me whether the test or the app is wrong before changing anything."*

Once a role's prompt works well, save it so you don't retype it: as a Claude Code subagent (`.claude/agents/planner.md`)
or a Copilot prompt file (`.github/prompts/planner.prompt.md`).
