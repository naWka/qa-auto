// Grading of code against task checks: static rules + expected run outcomes on one or more app versions.
import { analyze, checkRules, type AppSetup, type RunResult } from '../emulator';
import type { Checks, T } from '../content/schema';
import { errorTexts } from '../content';
import { interpolate } from '../lib/text';

export interface CodeVerdict {
  ok: boolean;
  problems: T[];
  main?: RunResult;
  also: { app: AppSetup; expect: 'pass' | 'fail'; result: RunResult; ok: boolean }[];
  fragileFree: boolean;
  /** outcomes of repeated runs (checks.repeat) */
  repeats?: ('passed' | 'failed')[];
}

// A red run counts when the test caught something: a failed assertion, or a user action the app doesn't allow
// (element missing / not actionable). The `also` run on the fixed app guards against simply wrong locators.
const ASSERTION_CODES = new Set(['expect-failed', 'expect-not-found', 'expect-count', 'expect-url', 'expect-generic', 'action-timeout', 'action-not-actionable']);

export function outcomeMatches(r: RunResult, expect: 'pass' | 'fail'): boolean {
  if (expect === 'pass') return r.status === 'passed';
  if (r.status !== 'failed') return false;
  // Not a syntax error, a Python error or a strict-mode violation.
  return r.tests.some((t) => t.status === 'failed' && t.error && ASSERTION_CODES.has(t.error.code));
}

export async function gradeCode(
  code: string,
  checks: Checks | undefined,
  app: AppSetup | undefined,
  run: (code: string, app: AppSetup | undefined, silent: boolean) => Promise<RunResult>,
): Promise<CodeVerdict> {
  const problems: T[] = [];
  let fragileFree = true;
  try {
    const a = analyze(code);
    fragileFree = !a.findings.some((f) => f.rule === 'fragile-locator');
    for (const f of checkRules(checks?.static as never, a)) {
      const base = f.message ?? errorTexts.rules[f.rule];
      if (base) problems.push({ en: interpolate(base.en, { value: f.value ?? '', line: f.line ?? '?' }), ru: interpolate(base.ru, { value: f.value ?? '', line: f.line ?? '?' }) });
    }
  } catch {
    /* syntax errors are reported by the run */
  }

  const expect = checks?.expect ?? 'pass';
  const main = await run(code, app, false);
  if (!outcomeMatches(main, expect)) {
    if (main.status === 'error') problems.unshift({ en: 'The code has an error and the tests could not run — see the report.', ru: 'В коде ошибка, тесты не запустились — посмотри отчёт.' });
    else if (expect === 'pass') problems.unshift({ en: 'The test should pass, but it failed — see the report.', ru: 'Тест должен пройти, но упал — посмотри отчёт.' });
    else if (main.status === 'passed') problems.unshift({ en: 'The test passed on the buggy app — it doesn\'t catch the bug yet. Check the exact expected result.', ru: 'Тест прошёл на версии с багом — значит, баг он пока не ловит. Проверь точный ожидаемый результат.' });
    else problems.unshift({ en: 'The test failed, but not because of an assertion — fix the error first.', ru: 'Тест упал, но не из-за проверки — сначала исправь ошибку.' });
  }
  if (checks?.minTests && main.tests.length < checks.minTests) {
    problems.push({ en: `Expected at least ${checks.minTests} tests, found ${main.tests.length}.`, ru: `Ожидалось минимум ${checks.minTests} тестов, найдено ${main.tests.length}.` });
  }

  let repeats: CodeVerdict['repeats'];
  let repeatFailed = false;
  if (checks?.repeat && outcomeMatches(main, expect)) {
    repeats = [main.status === 'passed' ? 'passed' : 'failed'];
    for (let i = 1; i < checks.repeat; i++) {
      const r = await run(code, app, true);
      repeats.push(outcomeMatches(r, expect) ? (expect === 'pass' ? 'passed' : 'failed') : (expect === 'pass' ? 'failed' : 'passed'));
      if (!outcomeMatches(r, expect)) {
        repeatFailed = true;
        const good = repeats.filter((x) => x === (expect === 'pass' ? 'passed' : 'failed')).length;
        problems.push({ en: `Run ${i + 1} of ${checks.repeat} went the other way (${good} of ${i + 1} as expected). The test is still flaky — look for what it assumes about timing.`, ru: `Прогон ${i + 1} из ${checks.repeat} дал другой результат (как ожидалось — ${good} из ${i + 1}). Тест всё ещё нестабилен — ищи, какие допущения о времени он делает.` });
        break;
      }
    }
  }

  const also: CodeVerdict['also'] = [];
  if (outcomeMatches(main, expect) && !repeatFailed) {
    for (const extra of checks?.also || []) {
      const result = await run(code, extra.app as AppSetup, true);
      const ok = outcomeMatches(result, extra.expect);
      also.push({ app: extra.app as AppSetup, expect: extra.expect, result, ok });
      if (!ok) {
        const variant = (extra.app as AppSetup).variant;
        problems.push(extra.expect === 'fail'
          ? { en: 'On the other app version the test should fail, but it passed.', ru: 'На другой версии приложения тест должен упасть, но прошёл.' }
          : variant === 'redesign'
            ? { en: 'After the redesign the test fails: it depends on class names or the page layout. Find elements the way a user does — by role, label, text or test id.', ru: 'После редизайна тест падает: он зависит от имён классов или вёрстки. Ищи элементы так, как их ищет пользователь, — по роли, подписи, тексту или test id.' }
            : variant === 'sign-in'
              ? { en: 'On the version with the renamed button the test fails. Is the button\'s name written in more than one place?', ru: 'На версии с переименованной кнопкой тест падает. Имя кнопки записано больше чем в одном месте?' }
              : (extra.app as AppSetup).bugs?.length
                ? { en: 'On another app version the test should pass, but it failed.', ru: 'На другой версии приложения тест должен пройти, но упал.' }
                : { en: 'On the fixed app the test fails too — so it fails for the wrong reason. A good bug-catching test is green when the bug is gone.', ru: 'На исправленной версии тест тоже падает — значит, падает не из-за бага. Хороший тест, ловящий баг, зеленеет, когда бага нет.' });
      }
    }
  }
  return { ok: problems.length === 0, problems, main, also, fragileFree, repeats };
}
