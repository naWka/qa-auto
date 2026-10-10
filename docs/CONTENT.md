# Content authoring guide

Everything the student reads lives in YAML under `src/content/`. Schemas: `src/content/schema.ts`.
Validate with `npm run check:content`. Code tasks are additionally verified in the browser by the
self-test page (`#/dev/selftest`), which runs every reference solution in the emulator.

Read also: `docs/AUT.md` (the Bloomly app — exact labels, roles, texts, bugs) and
`docs/EMULATOR.md` (supported Playwright API).

## 1. Audience and approach

- Russian-speaking women, **experienced manual QA engineers (~3 years)**: test cases, checklists, bug reports,
  test design (boundary values, negative cases), regression — all known. They are **not juniors**. No coding background.
- Goal: move into automation **with AI agents**. The AI (Claude Code, Copilot, agents built on Playwright MCP / CLI) writes most
  of the code. The student must **understand, direct, review and verify** it.
- Core message, repeated in many forms: *"The agent writes code fast. You know what is worth checking.
  In test design you are stronger than the agent."*
- Python only to reading level. No syntax drills, no "write a loop from scratch". Tests are pytest + pytest-playwright
  (sync API) — see docs/EMULATOR.md.
  Task mix per lesson: ~60% read / review / predict, ~25% prompt / agent / verdict, ~15% small one-line fixes.
- Always build from their experience: "you did this by hand — here is how code does the same".
- One idea per screen. A lesson = one new idea, 5–10 minutes. Short paragraphs (1–3 sentences each).
- Retrieval over reading: little theory, many short tasks. Scaffolding fades inside a lesson:
  worked example → example with gaps → task with hints → task without support.
- English is a learning goal too: use professional English as used in real teams (B1–B2, short sentences).

## 2. Voice, bilingual text, special syntax

Every student-facing text is `{ en: "...", ru: "..." }`.
- `en` is the main text; `ru` is a natural Russian translation (not a calque). Keep paragraphs aligned 1:1.
- Code, test names, code comments, prompts to the agent — **English only** (as in real projects).
- Tone: a warm, smart senior colleague. Supportive, never childish. Praise is specific
  ("you picked a resilient locator — that's how senior engineers do it").
  Mistakes are normal and useful. Never call a wrong answer right.
- **Russian addressing the student uses gender variants** `{feminine|masculine}`:
  `Ты {готова|готов}`, `ты наш{ла|ёл} баг`, `ты справил{ась|ся}`, `Ты молодец`. Feminine first.
  Every past-tense verb / short adjective about the student MUST use this syntax.
  Maya (mentor) is a woman: her own first-person past tense is feminine and fixed ("я нашла").
  Petal (AI agent) is grammatically masculine in Russian ("агент написал").
- Term links: `[[locator]]` (display = id) or `[[display text|term-id]]`.
  EN: `[[locators|locator]]`; RU: `[[локатор|locator]]`, `[[локаторы|locator]]`.
  Link a term on its first mention in a step, not every time. Only ids that exist in the glossary (§9).
- Markdown subset in text: `**bold**`, `*italic*`, `` `inline code` ``, lists, fenced code blocks (```python).
  No headings, no tables, no HTML.

## 3. Story

Bloomly — an international flower-delivery startup (Lisbon / Berlin / Warsaw, working language English).
"Bloomly 3.0" ships before the holiday season. Manual regression = ~400 test cases, 3 days per release.
Leo wants regression automated with the team's AI agent **Petal**. But Petal does not know what is
important to check — that's why they hired **you**, an experienced QA, to lead it.

Speakers (`who`): `maya` (Maya Chen, Senior QA, your mentor, she/her), `mochi` (office cat — only short
sounds/reactions, e.g. "Mrrp?"), `petal` (AI agent, polite, a bit too confident), `leo` (Leo Martins, Engineering
Manager), `sofia` (Sofia Weber, PM), `kai` (Kai Nowak, frontend dev), `you` (the student; RU with gender variants).

Chapters = departments: 1 Onboarding · 2 AI Lab · 3 Engineering · 4 Frontend · 5 Design System · 6 Checkout ·
7 Platform · 8 QA Guild · 9 Architecture · 10 Backend · 11 Release Day.

## 4. Files and ids

```
src/content/chapters/01-tester-eyes/chapter.yaml
src/content/chapters/01-tester-eyes/l1-why-automate.yaml   # one lesson per file
src/content/glossary/c01.yaml                              # glossary entries owned by chapter 1
```
Ids: lesson `c1-l2`; key point `kp-short-name`; tasks `c1-l2-t1` (lesson tasks), `c1-l2-p1` (pretest),
`c1-l2-k1` (check pool), `c1-boss-t1` (boss). All ids globally unique.

## 5. Lesson recipe

```yaml
id: c1-l2
chapter: c1
title: { en: "Steps become actions", ru: "Шаги становятся действиями" }
goal: { en: "Read a test and match each line to a test-case step.", ru: "..." }
minutes: 8
keyPoints:                  # 2–4 ideas the lesson teaches; tasks reference them
  - id: kp-goto
    title: { en: "page.goto opens a page", ru: "page.goto открывает страницу" }
terms: [tick, swapped, happy-path, ambiguous]   # 5–8 ids → auto "Vocabulary" block at the end (see §9 "What goes into terms")
steps: [...]
checkPool: [...]            # 8 tasks for "I know this" checks, review and placement
```

Recommended step order (≈12–16 screens):
1. `story` — 1–3 lines: why this matters today at Bloomly.
2. `pretest` — 1–2 quick questions on the new idea *before* teaching (intro says: mistakes are fine).
3. `theory` — 2–4 screens, one idea each, with an analogy from manual testing. Optional `figure`, `mentor` aside.
4. `example` or `mapping` — fully worked example with line notes.
5. Tasks (5–7), fading support: e.g. `choice` → `fill` / `parsons` → `review` / `agent` → `predict` → `fix`.
   At least one `predict` and one `review` or `agent` per lesson (chapters 1–3).
6. `mistakes` — 2–4 typical mistakes (often mistakes AI agents make).
7. `explain` — "explain in your own words" + a good model answer.
8. `phrases` — "How to say it at work": 4–6 phrases (standup, code-review, bug-report, chat, prompt).
(The vocabulary block is added automatically from `terms`.)

Every task should have `keyPoint`, 2–3 `hints` (hint → direction → almost the answer), `explain`
(why the answer is right — shown after answering) and often `praise` (specific).

### checkPool (8 tasks)
Practice, not theory recall: review, predict, fix, fill, pick-locator, agent, choice-on-code.
Cover every key point at least twice. Different from the lesson tasks (new code, new situations).
Mark 1–2 quick ones (`choice`/`fill`/`predict`/`input`) with `placement: true` (used in the entry test).

## 6. Step types

```yaml
- type: story
  lines:
    - who: maya
      text: { en: "...", ru: "..." }

- type: pretest
  intro: { en: "Quick guess before we start. Wrong answers are fine — they help you remember.", ru: "..." }
  items: [ <task>, <task> ]           # 1–2 quick tasks (choice / input / predict)

- type: theory
  keyPoint: kp-goto
  title: { en: "...", ru: "..." }
  body:                                # paragraphs, EN and RU aligned
    - { en: "...", ru: "..." }
  code: |                              # optional snippet
    page.goto("/login")
  figure: agent-loop                   # optional: agent-loop | test-anatomy | manual-vs-auto | dom-tree | review-checklist | red-green
                                       #   | locator-priority | actionability | flaky-causes | test-agents | review-gates
                                       #   | page-object | fixture-lifecycle | http-exchange | ui-vs-api | ci-pipeline
  mentor: { en: "...", ru: "..." }     # optional aside from Maya

- type: example                        # worked example, notes attached to line numbers (1-based)
  title: {...}
  intro: {...}
  code: |
    def test_user_can_log_in(page: Page):
        page.goto("/login")
  notes:
    - lines: 1
      text: {...}
    - lines: [2, 3]
      text: {...}
  runnable: true                       # optional: "Run" button executes it in the emulator

- type: mapping                        # manual test case ↔ code
  title: {...}
  testCase:
    id: TC-001
    title: Registered user can log in
    preconditions: ["User anna@bloomly.app exists"]
    steps:
      - { action: "Open the login page" }
      - { action: "Enter email", data: "anna@bloomly.app" }
      - { action: "Click \"Log in\"", expected: "Account page shows \"Welcome back, Anna!\"" }
  code: |
    ...
  links:                               # s<N> = action of step N, e<N> = expected result of step N
    - { from: s1, lines: [2] }
    - { from: e3, lines: [6] }

- type: inspect                        # live page + DevTools-like inspector (chapter 4+)
  title: {...}
  intro: {...}
  app: { route: /login }               # any AppConfig (state, bugs…)
  focus: "#email"                      # optional: element selected at start (CSS, must match 1 element)
  view: both                           # dom | aria | both (default both: Elements tree + agent's snapshot)
  mentor: {...}

- type: trace                          # records the run and opens a simplified trace viewer (chapter 7+)
  title: {...}
  intro: {...}
  code: |
    def test_...(page: Page): ...
  app: {...}
  files: {...}                         # optional project files (pages/login_page.py, conftest.py)
  mentor: {...}

- type: task
  task: <task>

- type: mistakes
  title: {...}
  items:
    - wrong: "page.wait_for_timeout(3000)"
      right: "expect(page.get_by_text(\"Saved\")).to_be_visible()"
      why: {...}

- type: explain
  prompt: { en: "In your own words: why does a test need an assertion?", ru: "..." }
  model: { en: "...", ru: "..." }

- type: phrases
  items:
    - context: standup                 # standup | code-review | bug-report | chat | meeting | prompt
      en: "I automated the login smoke test yesterday; today I'm reviewing the checkout tests."
      ru: "..."
      note: {...}                      # optional usage tip
```

## 7. Task kinds

Common fields: `id`, `kind`, `keyPoint`, `prompt` (T), optional `context` (T, shown above), `testCase`
(manual test case card shown above), `hints` (≤3 T), `praise` (T), `explain` (T), `app` (AppConfig, see
docs/AUT.md), `placement`.

```yaml
# Multiple choice. Options may be code (optionsCode: true) or bilingual text. multi: true = checkboxes.
# Optional `code` snippet or `diff` (before/after) above the question. run: script = run plain Python after answering.
- id: c1-l2-t1
  kind: choice
  keyPoint: kp-goto
  prompt: { en: "Which line opens the login page?", ru: "..." }
  code: |
    ...
  options:
    - text: 'page.goto("/login")'
      correct: true
      why: { en: "...", ru: "..." }
    - text: 'page.open("/login")'
      why: { en: "There is no `page.open` in Playwright — a typical AI hallucination.", ru: "..." }
  optionsCode: true

# Short typed answer (case-insensitive by default)
- id: c3-l1-t2
  kind: input
  prompt: {...}
  code: |
    email = "anna@bloomly.app"
  answers: ["anna@bloomly.app"]

# Fill the gaps: ___ (3 underscores) in code; one blank entry per gap, in order.
# With `options` the blank is a dropdown (more support), without — typed input (less support).
- id: c1-l2-t3
  kind: fill
  code: |
    page.get_by_label("Email").___("anna@bloomly.app")
    page.get_by_role("button", name="Log in").___()
  blanks:
    - { answers: [fill], options: [fill, click, check] }
    - { answers: [click] }
  checks: { expect: pass }             # optional: also runs the completed code; omit for snippets that are not full tests

# Parsons: lines in correct order; student reorders shuffled lines. distractors = extra wrong lines.
# alt = other accepted orders (as index arrays of `lines`). code: false for non-code lines (e.g. workflow steps as text).
- id: c1-l2-t4
  kind: parsons
  lines:
    - "def test_user_can_log_in(page: Page):"
    - "    page.goto(\"/login\")"
    - "    page.get_by_label(\"Email\").fill(\"anna@bloomly.app\")"
    - "    page.get_by_label(\"Password\").fill(\"bloom123\")"
    - "    page.get_by_role(\"button\", name=\"Log in\").click()"
    - "    expect(page).to_have_url(\"http://localhost:3000/account\")"
  alt: [[0, 1, 3, 2, 4, 5]]
  distractors: ["    page.wait_for_timeout(5000)"]          # indentation is part of each line
  checks: { expect: pass }             # optional: run the assembled test

# Match pairs (left ↔ right). leftCode/rightCode render a side as code.
- id: c1-l1-t5
  kind: match
  pairs:
    - left: { en: "Step: open the login page", ru: "..." }
      right: 'page.goto("/login")'
  rightCode: true

# Predict, then run: student says pass/fail (+ optional reason), then sees the real run.
- id: c1-l3-t6
  kind: predict
  app: { bugs: [greeting-wrong-name] }
  code: |
    def test_...(page: Page): ...
  outcome: fail                         # must match the real emulator result (self-test checks it)
  reasons:                              # optional "why?" choice
    - text: {...}
      correct: true
    - text: {...}

# Pick the best locator for the highlighted element (target = CSS selector inside the AUT, for highlighting only).
- id: c4-l1-t2
  kind: pick-locator
  app: { route: /login }
  target: "#email"
  options:
    - { text: 'page.get_by_label("Email")', correct: true, why: {...} }
    - { text: 'page.locator("#login-form > input:nth-child(3)")', why: {...} }

# Code review of AI-generated code: student flags problem lines and picks the issue type.
# line: 1-based line number in `code`; line: 0 = test-level issue (e.g. the whole test has no assertion).
# Issue types: fragile-locator, no-assertion, weak-assertion, wrong-assertion, hard-wait, not-called,
#              hallucination, wrong-data, test-dependency, wrong-step
- id: c2-l3-t2
  kind: review
  context: { en: "Petal generated this test for TC-002.", ru: "..." }
  testCase: {...}                       # often useful: the case the code should implement
  code: |
    ...
  issues:
    - line: 3
      type: fragile-locator
      note: {...}
    - line: 0
      type: no-assertion
      note: {...}
  types: [fragile-locator, no-assertion, hard-wait, wrong-data]   # optional: limit the dropdown

# Simulated AI agent. Student composes a prompt from blocks (English text + RU translation),
# the "agent" answers with the first response whose `when` blocks are all included
# (and no `unless` block). `best: true` marks the target. `missing`: consequence shown when a block was left out.
# Then the student runs the generated code. Explain clearly that the real agent's output varies.
- id: c2-l2-t3
  kind: agent
  testCase: {...}
  blocks:
    - { id: task, locked: true, text: "Write a Playwright test for the Bloomly login.", ru: "Напиши Playwright-тест на вход в Bloomly." }
    - { id: steps, text: "Steps: open /login, log in as anna@bloomly.app with password bloom123.", ru: "..." }
    - { id: expected, text: "Expected: the account page shows the heading \"Welcome back, Anna!\".", ru: "..." }
    - { id: locators, text: "Use get_by_role and get_by_label locators. No CSS classes.", ru: "..." }
    - { id: noise, text: "Make it perfect, please!", ru: "Сделай идеально, пожалуйста!" }
  responses:
    - when: [steps, expected, locators]
      best: true
      message: {...}                   # agent's chat reply
      code: |
        ...
    - when: [steps, expected]
      message: {...}
      code: |                           # e.g. uses CSS selectors
        ...
    - when: []
      message: {...}
      code: |                           # e.g. no assertion
        ...
  missing:
    expected: { en: "Without the expected result the agent had nothing to check — the test has no assertion.", ru: "..." }
  checks: { expect: pass }              # applied when running the best response (self-test)

# Edit code so that it passes (fix), so that it catches a bug (find-bug), or write it (code — rare).
# find-bug: checks.expect = fail on the buggy app AND `also` a passing run on the fixed app.
- id: c1-l4-t5
  kind: fix
  starter: |
    ...
  solution: |
    ...
  checks:
    expect: pass
    static: [hasAssertion, noHardWait]  # also: noFragile, callsMethods, {rule: uses|notUses|regex|notRegex|minExpects, value, message}

- id: c1-boss-t2
  kind: find-bug
  app: { bugs: [cart-total-ignores-qty], state: { cart: [{ id: rose-bouquet, qty: 2 }] } }
  starter: |
    ...
  solution: |
    ...
  checks:
    expect: fail
    also:
      - app: { state: { cart: [{ id: rose-bouquet, qty: 2 }] } }
        expect: pass

# Inspect: the student picks an element on the live page, in the DOM tree or in the accessibility snapshot.
# target = CSS selector of the right element(s) (el.matches(target)). show = what the details panel reveals while
# answering (fading support; everything is shown after the answer). view: dom | aria | both.
- id: c4-l3-t2
  kind: inspect
  app: { route: /cart, state: { cart: [{ id: rose-bouquet, qty: 1 }] } }
  prompt: { en: "Find the element whose accessible name is “Increase Rose Bouquet”.", ru: "..." }
  target: "[aria-label='Increase Rose Bouquet']"
  view: aria
  show: [attributes]

# Trace: the run is recorded; the student clicks the action where things went wrong (answer = code line(s) of that
# action) and optionally picks a diagnosis. outcome = real run result (self-test checks it).
- id: c7-l3-t3
  kind: trace
  app: { state: { cart: [{ id: rose-bouquet, qty: 1 }] } }
  code: |
    ...
  answer: 5
  outcome: fail
  options:
    - { text: { en: "A bug in the test: wrong promo code", ru: "..." }, correct: true, why: {...} }
    - { text: { en: "A bug in the app", ru: "..." }, why: {...} }

# Virtual files (chapter 9+): any runnable task (fix/find-bug/code, predict, agent, fill, parsons, trace)
# and example steps accept `files` — extra project files next to the test file. In fix/find-bug tasks the student
# can edit them (tabs above the editor); `solutionFiles` holds the reference version (defaults to `files`).
# Agent responses may carry their own `files`. Imports: `from pages.login_page import LoginPage`;
# fixtures from `conftest.py` are available to every test without an import.
- id: c9-l2-t5
  kind: fix
  files:
    pages/login_page.py: |
      class LoginPage: ...
    conftest.py: |
      import pytest
      ...
  solutionFiles:
    pages/login_page.py: |
      class LoginPage: ...
  starter: |
    from playwright.sync_api import Page, expect
    from pages.login_page import LoginPage
    ...
  solution: |
    ...
  checks: { expect: pass }

# Vocabulary quiz
- id: c1-l1-t7
  kind: vocab
  mode: cloze                           # cloze | translate | match
  sentence: { en: "Please don't just ___ the test until it turns green — read the error first.", ru: "Пожалуйста, не перезапускай тест, пока он не позеленеет, — сначала прочитай ошибку." }
  answer: rerun                         # the ru line is shown under the gap: it must not contain a cognate of the answer
  options: [rerun, triage, spot]
- id: c1-l1-t8
  kind: vocab
  mode: translate
  term: assertion
  direction: en-ru
- id: c1-l1-t9
  kind: vocab
  mode: match
  terms: [tick, swapped, plausible, happy-path]   # pairs EN ↔ RU from the glossary (English in brackets is hidden)
```

## 8. Rules for code in tasks

- Code must run in the emulator against Bloomly **exactly as documented in docs/AUT.md** (labels, names, texts).
  Prefer full tests: `def test_user_can_log_in(page: Page): ...`. Include
  `from playwright.sync_api import Page, expect` in full-file examples (plus `import re` / `import pytest` when used).
- Python style (PEP 8): 4-space indents, double quotes, `snake_case` names, two blank lines between top-level
  functions/classes, test names that read like test-case titles (`test_wrong_password_shows_an_error`).
- Use only API from docs/EMULATOR.md. Test names and comments in English.
- URLs: `page.goto("/login")` (base URL is set in pytest.ini); URL checks with
  `expect(page).to_have_url("http://localhost:3000/account")` or `expect(page).to_have_url(re.compile(r"/account$"))`.
- Every `fix` / `find-bug` / `code` task has a `solution` that satisfies `checks`. Every `predict` has the true `outcome`.
  Every `agent` best response passes its `checks`. Self-test verifies all of this.
- Keep snippets short (≤ 15 lines for tasks; boss up to ~25).
- AI-generated code in `review`/`agent` should contain realistic AI mistakes: invented methods (`page.open`,
  `get_by_button`), JavaScript habits in Python (`getByRole`, `await`, `{ name: "…" }`), CSS-class selectors,
  `wait_for_timeout` / `time.sleep`, missing assertion, `assert page.get_by_text("…")` (always true),
  `assert x.is_visible()` (no retry), `expect(x).to_be_visible` without `()`, wrong expected text vs the test case,
  wrong test data, steps that don't match the case.
- Check code without a browser with `npm run check:code -- <lesson-id>`; browser outcomes with `#/dev/selftest`.
- Use `app.state` to preset login/cart when the lesson isn't about those steps.
- `app.variant: redesign` (docs/AUT.md) = same app after a design-system migration; use it to prove a locator is
  resilient (`also: [{ app: { variant: redesign }, expect: pass }]`).
- Flaky tests: random `app.latency` ranges make runs non-deterministic — never in `predict`/`trace`; use `fix` with
  `checks.repeat: 5` (must pass 5 runs in a row) and make the starter fail most runs. Example steps can offer
  "Run ×N" with `runnable: true` + `repeat: 10`.

## 9. Glossary

One file per owning chapter: `src/content/glossary/cNN.yaml` = list of entries:

```yaml
- id: assertion
  en: assertion
  ipa: /əˈsɜːrʃn/
  ru: проверка (assertion)
  pos: noun
  def: { en: "A line of code that checks the expected result.", ru: "Строка кода, которая проверяет ожидаемый результат." }
  example: { en: "The test has no assertion, so it can never fail.", ru: "В тесте нет проверки, поэтому он никогда не упадёт." }
  context: code-review                 # standup | code-review | bug-report | chat | meeting | prompt | general
  chapter: 1
```
`example` = a realistic sentence from standup / code review / bug report / Slack. IPA in American English.
`example.en` must contain the exact `en` string: the flashcard cuts out its first (case-insensitive) occurrence to
make a gap, so that occurrence must be the term itself, not part of a longer word. New entries: `ru` without the
English in brackets (quizzes hide brackets anyway).

### What goes into a lesson's `terms`

`terms` is the lesson's vocabulary: the end-of-lesson word list, the flashcards and the "words learned" counter.
The student is an experienced manual QA, so it holds only English they don't know yet:
- **No loanwords or everyday QA jargon** — if the Russian is the English word in Cyrillic, or a Russian QA uses the
  word daily, it isn't worth learning: test case, bug, smoke, regression, test data, expected result, pass/fail,
  locator, element, DOM, XPath, prompt, LLM, MCP, code review, diff, function, method, argument, import, timeout…
  Such terms stay in the glossary for `[[links]]`, but not in `terms`.
- **Yes:** automation terms whose English isn't transparent (assertion, flaky test, false negative, accessible name,
  indentation, traceback, strict mode) and work English from the lesson's own texts — phrasal verbs, collocations,
  adjectives a QA needs in a standup, a review comment, a bug report or a prompt (slip through, file a bug, walk me
  through, heads-up, narrow down, false alarm, hard-coded, on purpose, trade-off).
- The term must occur in the lesson's English text. 5–8 terms per lesson. One word = one lesson: if the word is
  already in another lesson's `terms`, pick another one (the glossary entry lives in the chapter that uses it first).
- Vocab tasks follow the same rule: no cloze whose answer is a cognate the Russian line gives away
  ("галлюцинация" → hallucination), no match with trivial pairs.

Term ownership (who writes the entry; anyone may *reference* any id). Base terms:
- **c1**: manual-testing, test-automation, automated-test, test-case, test-step, expected-result, actual-result,
  regression-testing, test-suite, test-file, test-runner, action, assertion, locator, test-report, pass, fail,
  precondition, test-data, smoke-test, timeout, bug
- **c2**: llm, ai-agent, prompt, context, hallucination, mcp, accessibility-snapshot, code-review, diff,
  false-positive, false-negative, request-changes, test-coverage, edge-case, negative-test
- **c3**: code, syntax, variable, constant, string, f-string, number, boolean, none, function, parameter,
  argument, keyword-argument, object, property, method, list, dictionary, loop, indentation, import, decorator,
  comment, error-message, traceback
- **c4–c11** (written together with the chapter stubs): dom, html, element, tag, attribute, devtools, inspect,
  css-selector, xpath, test-id, role, accessible-name, accessibility · fragile-selector, resilient-locator,
  strict-mode, chaining, filter · web-first-assertion, retry, soft-assertion, actionability · auto-waiting,
  flaky-test, race-condition, hard-wait, trace-viewer, debugging, self-healing · test-plan, planner, generator,
  healer, seed-test, project-rules · test-isolation, conftest, test-class, setup, teardown, page-object-model,
  class, fixture, parameterization, data-driven-testing, refactoring · api-testing, endpoint, request, response,
  status-code, http-method, payload, json, header, auth-token · ci-cd, pipeline, codegen, html-report, headless,
  cross-browser-testing, pull-request, repository, commit, portfolio, config-file, virtual-environment

Work-English vocabulary (2026-10 pass):
- **c1**: click-through, slip-through, repetitive, exploratory-testing, pay-off, one-off, vague, worth, tick, fill-in,
  line-by-line, swapped, plausible, happy-path, ambiguous, outage, wording, spot, turn-red, catch-a-bug, go-unnoticed,
  nightly-run, triage, file-a-bug, rerun, on-purpose, outdated, for-the-right-reason
- **c2**: pair-with, own, check-against, mix-up, boundary-value, report-back, precise, leave-out, turn-into,
  fall-back-on, case-sensitive, generic, address, subtle, back-and-forth, fall-for, overkill, cover-up, sneaky
- **c3**: quotes, lowercase, trailing-space, character-by-character, double-check, helper, call, extract,
  walk-me-through, type-hint, line-up, brackets, colon, misspelled, up-front, just-to-be-safe, hard-coded,
  square-brackets, curly-braces, show-up, the-catch, at-a-glance, cut-corners
- **c4**: skeleton, live, nested, layout, heading, bet-on, heads-up, survive, land, tell-apart, convention, sighted,
  announce, reach, user-impact, workaround, ship, make-up, evidence, quick-one, intended
- **c5**: last-resort, reach-for, read-like, user-facing, contract, trade-off, breaking-change, false-alarm, stale,
  cry-wolf, relax, blind-to, narrow-down, resolve-to, silence, off-by-one, clarifying-question, from-memory,
  start-fresh, short-lived, escape-hatch, enforce, keep-in-sync, per, fail-quietly

### Audio

Glossary terms and examples, lesson work phrases (`phrases` steps) and interview questions and answers have
pre-generated audio: `npm run audio` reads them with Kokoro (local, needs [uv](https://docs.astral.sh/uv/)) into
`public/audio/*.mp3` and updates `src/content/audio.json`. Only new or changed texts are generated; files nobody
uses are removed. Commit both. A text without audio is read by the browser voice, and `check:content` warns.

Before the engine gets a text, inline code is turned into what a developer would say
(`page.getByRole('button')` → "page dot get by role button"), camelCase is split, emails and case ids are spelled
out. Words it still gets wrong go to `src/content/pronounce.yaml` (`JSON: Jason`). To see what the engine gets:
`npm run audio -- --say "text"`.

### Playground bug hunt

`src/content/playground.yaml`: every switchable Bloomly bug (docs/AUT.md) as a bug report — `title`, `steps`,
`expected`, `actual`, optional preconditions `app.state` — plus Petal's draft test (`starter`, a key in `starters`),
a `hint` and a `solution`. The draft must pass on the fixed app **and** with the bug (it misses the bug); the solution
must pass on the fixed app and fail with the bug through an assertion or a blocked action (the same rule as
`find-bug`). `check:content` validates the file, `check:code` parses the code, `#/dev/selftest` (filter `hunt-`)
runs both. A new bug in `public/aut/app.js` or `src/emulator/api.ts` gets an entry here.

## 10. Quality checklist

- [ ] EN/RU paragraphs aligned, RU natural; gender variants on every past-tense verb about the student.
- [ ] One idea per screen; no wall of text (≤ 3 short paragraphs per theory step).
- [ ] Analogy from manual QA in every lesson. AI angle in every lesson (what the agent does / gets wrong).
- [ ] Hints go from gentle to almost-the-answer. `explain` says *why*.
- [ ] Code uses exact Bloomly labels/texts; full tests runnable.
- [ ] 8 checkPool tasks, every key point ≥ 2 times, 1–2 `placement: true`.
- [ ] Only existing term ids; first mention linked.
