# Bloom QA — Playwright with AI

A bilingual (EN + RU) gamified trainer for experienced manual QA engineers who move into test
automation. The AI agent writes the code; the student learns to understand, direct, review and verify it.

**Live:** https://nawka.github.io/qa-auto/

## What's inside

- **Lessons** with fading support: pre-test → explanation from manual-QA experience → worked example →
  tasks (choice, fill-in, Parsons, matching, predict-then-run, pick-the-locator, code review of AI output,
  simulated AI agent prompting, fix the test, catch the bug) → typical mistakes → explain in your own words →
  vocabulary and "how to say it at work".
- **Playwright emulator** running in the browser against **Bloomly**, a small shop app with switchable bugs
  (`public/aut`). The API mirrors Playwright Test (`test`, `expect`, `page.getByRole`, web-first assertions,
  auto-waiting, strict mode, fixtures, `request`). Step-by-step mode highlights each element; the report looks
  like Playwright's, with bilingual explanations. Simplifications are marked "Emulator note".
- **Spaced repetition** (SM-2) for terms and topics, "I know this" checks with practical task pools,
  an entry check, XP, levels, sticker badges, streaks, a glossary with pronunciation, interview prep.
- Everything is static; progress lives in `localStorage` (export/import/reset in Settings).

## Develop

```bash
npm install
npm run dev            # http://localhost:5173/qa-auto/
npm run check:content  # validate YAML content
npm run build          # content check + typecheck + production build
```

Open `#/dev/selftest` in the dev server to run every reference solution, prediction and best agent response
through the emulator.

## Content

All texts live in `src/content/*.yaml` (lessons per chapter, glossary, mentor phrases, UI strings, errors).
See `docs/CONTENT.md` for the format, `docs/AUT.md` for the app under test, `docs/EMULATOR.md` for the
supported Playwright API.

Russian texts use gender variants `{feminine|masculine}`; the default address is feminine and can be
switched in Settings.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds and publishes `dist/` to GitHub Pages.
