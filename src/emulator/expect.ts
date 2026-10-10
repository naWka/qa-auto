// expect(): web-first assertions with retries for Locator / Page / APIResponse (Playwright for Python wording).
import { isChecked, isDisabled, isEditable, isVisible } from './aria';
import { EmuError, callerLocation } from './errors';
import { normalizeWhitespace, previewElement } from './format';
import { BASE_URL, Locator, Page } from './page';
import { describeParts } from './selectors';
import type { Pending, TestRuntime } from './runtime';
import { APIResponse } from './api';

export const current: { rt: TestRuntime | null; expectTimeout: number | null } = { rt: null, expectTimeout: null };

function rt(): TestRuntime {
  if (!current.rt) throw new EmuError('expect-outside-test', 'expect: can only be called inside a test', {});
  return current.rt;
}

export interface Ctx {
  isNot: boolean;
  message?: string;
}

type Eval = { pass: boolean; received: string; notFound?: boolean };

/** to_have_text — Python name of a matcher */
export function pyMatcher(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace('to_have_u_r_l', 'to_have_url').replace('to_be_o_k', 'to_be_ok');
}

const PY_MESSAGES: Record<string, string> = {
  toBeVisible: 'Locator expected to be visible', toBeHidden: 'Locator expected to be hidden',
  toBeEnabled: 'Locator expected to be enabled', toBeDisabled: 'Locator expected to be disabled',
  toBeEditable: 'Locator expected to be editable', toBeChecked: 'Locator expected to be checked',
  toBeEmpty: 'Locator expected to be empty', toBeFocused: 'Locator expected to be focused',
  toBeAttached: 'Locator expected to be attached', toBeInViewport: 'Locator expected to be in viewport',
  toHaveText: 'Locator expected to have text', toContainText: 'Locator expected to contain text',
  toHaveValue: 'Locator expected to have Value', toHaveValues: 'Locator expected to have Values',
  toHaveAttribute: 'Locator expected to have attribute', toHaveClass: 'Locator expected to have class',
  toContainClass: 'Locator expected to contain class', toHaveId: 'Locator expected to have id',
  toHaveCount: 'Locator expected to have count', toHaveURL: 'Page URL expected to be', toHaveTitle: 'Page title expected to be',
};

/** "Locator expected to have text 'Welcome'" / "Locator expected not to be visible" */
function headline(name: string, isNot: boolean, expected: string | null, custom?: string): string {
  if (custom) return custom + (expected !== null ? `\nExpected value: '${expected}'` : '');
  const base = PY_MESSAGES[name] ?? `Expected ${pyMatcher(name)}`;
  const msg = isNot ? base.replace(' expected ', ' expected not ') : base;
  return expected !== null ? `${msg} '${expected}'` : msg;
}

/** str() of an expected value as Python prints it inside the message. */
export function pyStrArg(v: unknown): string {
  if (v instanceof RegExp) return `re.compile('${v.source}'${v.flags.includes('i') ? ', re.IGNORECASE' : ''})`;
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === 'string' ? `'${x}'` : pyStrArg(x))).join(', ')}]`;
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}

function textOf(el: Element, useInnerText?: boolean) {
  return normalizeWhitespace(useInnerText ? (el as HTMLElement).innerText : el.textContent || '');
}

function strMatch(actual: string, expected: unknown, mode: 'full' | 'contain', ignoreCase?: boolean): boolean {
  if (expected instanceof RegExp) return expected.test(actual);
  let a = actual;
  let e = normalizeWhitespace(String(expected));
  if (ignoreCase) { a = a.toLowerCase(); e = e.toLowerCase(); }
  return mode === 'full' ? a === e : a.includes(e);
}

const timeoutOf = (o: { timeout?: number } | undefined, r: TestRuntime) => o?.timeout ?? current.expectTimeout ?? r.expectTimeout;

/** Retrying assertion against a Locator. */
function locatorAssertion(
  loc: Locator,
  name: string,
  ctx: Ctx,
  opts: { timeout?: number } | undefined,
  expected: string | null,
  evaluate: (els: Element[]) => Eval,
  multi = false,
): Pending<void> {
  const r = rt();
  const where = callerLocation();
  const desc = describeParts(loc._parts);
  const py = (ctx.isNot ? 'not_' : '') + pyMatcher(name);
  return r.api(`Expect "${py}"`, 'expect', where, async () => {
    const timeout = timeoutOf(opts, r);
    const deadline = performance.now() + timeout;
    let last: Eval | undefined;
    let lastPreview = '';
    let lastValue = '';
    let repeats = 0;
    const log: string[] = [`  - Expect "${py}" with timeout ${timeout}ms`, `  - waiting for ${desc}`];
    const flush = () => {
      if (!repeats || !lastPreview) return;
      log.push(`    ${repeats > 1 ? `${repeats} × ` : ''}locator resolved to ${lastPreview}`, `      - unexpected value "${lastValue}"`);
    };
    let highlighted = false;
    for (;;) {
      r.checkAlive();
      const els = loc._resolve();
      if (!multi && els.length > 1) throw loc._strictError(`Expect "${py}"`, els);
      if (!highlighted && els[0] && isVisible(els[0])) {
        loc._page._highlight(els[0], `expect: ${desc}`);
        highlighted = true;
      }
      last = evaluate(els);
      if (last.pass !== ctx.isNot) {
        if (highlighted) {
          await r.pace(`expect ${desc}`, where?.line);
          loc._page._hideHighlight();
        }
        return;
      }
      const preview = els[0] ? previewElement(els[0]) : '';
      if (preview === lastPreview && last.received === lastValue) repeats++;
      else {
        flush();
        lastPreview = preview;
        lastValue = last.received;
        repeats = 1;
      }
      if (performance.now() > deadline) {
        flush();
        break;
      }
      await r.sleep(100);
    }
    loc._page._hideHighlight();
    const notFound = !!last?.notFound;
    const actual = notFound ? '<element(s) not found>' : last?.received ?? '';
    const msg = [headline(name, ctx.isNot, expected, ctx.message), `Actual value: ${actual}`, 'Call log:', ...log].join('\n');
    const code = notFound ? 'expect-not-found' : name === 'toHaveCount' ? 'expect-count' : 'expect-failed';
    throw new EmuError(code, msg, {
      matcher: py, locator: desc, expected: `${ctx.isNot ? 'not ' : ''}${expected ?? stateWord(name)}`, received: actual, not: ctx.isNot ? 'not ' : '',
    });
  });
}

function stateWord(name: string): string {
  return pyMatcher(name).replace(/^to_be_/, '').replace(/_/g, ' ');
}

function single(els: Element[]): Element | undefined {
  return els[0];
}

function stateMatcher(loc: Locator, name: string, ctx: Ctx, opts: Record<string, unknown> | undefined, yes: string, no: string, test: (el: Element) => boolean, missingIsPass = false) {
  return locatorAssertion(loc, name, ctx, opts as { timeout?: number }, null, (els) => {
    const el = single(els);
    if (!el) return { pass: missingIsPass, received: missingIsPass ? yes : '<element(s) not found>', notFound: !missingIsPass };
    const ok = test(el);
    return { pass: ok, received: ok ? yes : no };
  });
}

type Opts = { timeout?: number; useInnerText?: boolean; ignoreCase?: boolean };

export function locatorMatchers(loc: Locator, ctx: Ctx) {
  return {
    toBeVisible: (o?: { timeout?: number; visible?: boolean }) => {
      const want = o?.visible ?? true;
      return stateMatcher(loc, want ? 'toBeVisible' : 'toBeHidden', ctx, o, want ? 'visible' : 'hidden', want ? 'hidden' : 'visible', (el) => isVisible(el) === want, !want);
    },
    toBeHidden: (o?: { timeout?: number }) => stateMatcher(loc, 'toBeHidden', ctx, o, 'hidden', 'visible', (el) => !isVisible(el), true),
    toBeEnabled: (o?: { timeout?: number; enabled?: boolean }) => {
      const want = o?.enabled ?? true;
      return stateMatcher(loc, want ? 'toBeEnabled' : 'toBeDisabled', ctx, o, want ? 'enabled' : 'disabled', want ? 'disabled' : 'enabled', (el) => !isDisabled(el) === want);
    },
    toBeDisabled: (o?: { timeout?: number }) => stateMatcher(loc, 'toBeDisabled', ctx, o, 'disabled', 'enabled', (el) => isDisabled(el)),
    toBeEditable: (o?: { timeout?: number; editable?: boolean }) => {
      const want = o?.editable ?? true;
      return stateMatcher(loc, 'toBeEditable', ctx, o, want ? 'editable' : 'readOnly', want ? 'readOnly' : 'editable', (el) => isEditable(el) === want);
    },
    toBeChecked: (o?: { timeout?: number; checked?: boolean }) => {
      const want = o?.checked ?? true;
      return stateMatcher(loc, 'toBeChecked', ctx, o, want ? 'checked' : 'unchecked', want ? 'unchecked' : 'checked', (el) => {
        const t = el.tagName.toLowerCase() === 'label' ? (el as HTMLLabelElement).control || el : el;
        return (isChecked(t) === true) === want;
      });
    },
    toBeEmpty: (o?: { timeout?: number }) => stateMatcher(loc, 'toBeEmpty', ctx, o, 'empty', 'not empty', (el) => {
      const t = el.tagName.toLowerCase();
      if (t === 'input' || t === 'textarea') return (el as HTMLInputElement).value === '';
      return normalizeWhitespace(el.textContent || '') === '';
    }),
    toBeFocused: (o?: { timeout?: number }) => stateMatcher(loc, 'toBeFocused', ctx, o, 'focused', 'inactive', (el) => el.ownerDocument.activeElement === el),
    toBeAttached: (o?: { timeout?: number; attached?: boolean }) => {
      const want = o?.attached ?? true;
      return locatorAssertion(loc, 'toBeAttached', ctx, o, null, (els) => {
        const attached = els.length > 0;
        return { pass: attached === want, received: attached ? 'attached' : 'detached' };
      });
    },
    toBeInViewport: (o?: { timeout?: number }) => stateMatcher(loc, 'toBeInViewport', ctx, o, 'in viewport', 'outside viewport', (el) => {
      const r = el.getBoundingClientRect();
      const w = el.ownerDocument.defaultView!;
      return r.bottom > 0 && r.right > 0 && r.top < w.innerHeight && r.left < w.innerWidth;
    }),
    toHaveText: (expected: unknown, o?: Opts) => {
      if (Array.isArray(expected)) {
        return locatorAssertion(loc, 'toHaveText', ctx, o, pyStrArg(expected), (els) => {
          const texts = els.map((e) => textOf(e, o?.useInnerText));
          const pass = texts.length === expected.length && texts.every((t, i) => strMatch(t, expected[i], 'full', o?.ignoreCase));
          return { pass, received: pyStrArg(texts), notFound: !els.length };
        }, true);
      }
      return locatorAssertion(loc, 'toHaveText', ctx, o, pyStrArg(expected instanceof RegExp ? expected : normalizeWhitespace(String(expected))), (els) => {
        const el = single(els);
        if (!el) return { pass: false, received: '', notFound: true };
        const t = textOf(el, o?.useInnerText);
        return { pass: strMatch(t, expected, 'full', o?.ignoreCase), received: t };
      });
    },
    toContainText: (expected: unknown, o?: Opts) => {
      if (Array.isArray(expected)) {
        return locatorAssertion(loc, 'toContainText', ctx, o, pyStrArg(expected), (els) => {
          const texts = els.map((e) => textOf(e, o?.useInnerText));
          let i = 0;
          for (const t of texts) if (i < expected.length && strMatch(t, expected[i], 'contain', o?.ignoreCase)) i++;
          return { pass: i === expected.length, received: pyStrArg(texts), notFound: !els.length };
        }, true);
      }
      return locatorAssertion(loc, 'toContainText', ctx, o, pyStrArg(expected instanceof RegExp ? expected : normalizeWhitespace(String(expected))), (els) => {
        const el = single(els);
        if (!el) return { pass: false, received: '', notFound: true };
        const t = textOf(el, o?.useInnerText);
        return { pass: strMatch(t, expected, 'contain', o?.ignoreCase), received: t };
      });
    },
    toHaveValue: (expected: unknown, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveValue', ctx, o, pyStrArg(expected), (els) => {
      let el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      if (el.tagName.toLowerCase() === 'label') el = (el as HTMLLabelElement).control || el;
      const v = (el as HTMLInputElement).value ?? '';
      return { pass: expected instanceof RegExp ? expected.test(v) : v === String(expected), received: v };
    }),
    toHaveValues: (expected: unknown[], o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveValues', ctx, o, pyStrArg(expected), (els) => {
      const el = single(els) as HTMLSelectElement | undefined;
      if (!el) return { pass: false, received: '', notFound: true };
      const vals = Array.from(el.selectedOptions || []).map((x) => x.value);
      return { pass: vals.length === expected.length && vals.every((v, i) => expected[i] instanceof RegExp ? (expected[i] as RegExp).test(v) : v === expected[i]), received: pyStrArg(vals) };
    }),
    toHaveAttribute: (attr: string, expected?: unknown, o?: { timeout?: number }) => {
      if (expected === undefined) {
        return locatorAssertion(loc, 'toHaveAttribute', ctx, o, attr, (els) => {
          const el = single(els);
          if (!el) return { pass: false, received: '', notFound: true };
          const has = el.hasAttribute(attr);
          return { pass: has, received: has ? `has attribute "${attr}"` : `no attribute "${attr}"` };
        });
      }
      return locatorAssertion(loc, 'toHaveAttribute', ctx, o, pyStrArg(expected), (els) => {
        const el = single(els);
        if (!el) return { pass: false, received: '', notFound: true };
        const v = el.getAttribute(attr);
        return { pass: v !== null && (expected instanceof RegExp ? expected.test(v) : v === String(expected)), received: v === null ? 'None' : v };
      });
    },
    toHaveClass: (expected: unknown, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveClass', ctx, o, pyStrArg(expected), (els) => {
      const el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      const c = el.getAttribute('class') || '';
      return { pass: expected instanceof RegExp ? expected.test(c) : normalizeWhitespace(c) === normalizeWhitespace(String(expected)), received: c };
    }),
    toContainClass: (expected: string, o?: { timeout?: number }) => locatorAssertion(loc, 'toContainClass', ctx, o, expected, (els) => {
      const el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      const c = el.getAttribute('class') || '';
      return { pass: expected.split(/\s+/).every((x) => el.classList.contains(x)), received: c };
    }),
    toHaveId: (expected: unknown, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveId', ctx, o, pyStrArg(expected), (els) => {
      const el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      return { pass: expected instanceof RegExp ? expected.test(el.id) : el.id === expected, received: el.id };
    }),
    toHaveCount: (expected: number, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveCount', ctx, o, String(expected), (els) => ({ pass: els.length === expected, received: String(els.length) }), true),
  };
}

function pageAssertion(page: Page, name: string, ctx: Ctx, opts: { timeout?: number } | undefined, expected: string, get: () => string, test: (v: string) => boolean): Pending<void> {
  const r = rt();
  const where = callerLocation();
  const py = (ctx.isNot ? 'not_' : '') + pyMatcher(name);
  return r.api(`Expect "${py}"`, 'expect', where, async () => {
    const timeout = timeoutOf(opts, r);
    const deadline = performance.now() + timeout;
    let value = '';
    let repeats = 0;
    for (;;) {
      r.checkAlive();
      value = get();
      if (test(value) !== ctx.isNot) return;
      repeats++;
      if (performance.now() > deadline) break;
      await r.sleep(100);
    }
    const msg = [
      headline(name, ctx.isNot, expected, ctx.message),
      `Actual value: ${value}`,
      'Call log:',
      `  - Expect "${py}" with timeout ${timeout}ms`,
      `    ${repeats} × unexpected value "${value}"`,
    ].join('\n');
    void page;
    throw new EmuError(name === 'toHaveURL' ? 'expect-url' : 'expect-failed', msg, {
      matcher: py, expected, received: value, not: ctx.isNot ? 'not ' : '', locator: 'page',
    });
  });
}

export function pageMatchers(page: Page, ctx: Ctx) {
  return {
    toHaveURL: (expected: string | RegExp, o?: { timeout?: number; ignoreCase?: boolean }) => {
      let want: string | RegExp = expected;
      if (typeof expected === 'string') {
        try { want = new URL(expected, BASE_URL).href; } catch { want = expected; }
      }
      return pageAssertion(page, 'toHaveURL', ctx, o, pyStrArg(want), () => page.url(), (v) => (want instanceof RegExp ? want.test(v) : o?.ignoreCase ? v.toLowerCase() === want.toLowerCase() : v === want));
    },
    toHaveTitle: (expected: string | RegExp, o?: { timeout?: number }) => {
      return pageAssertion(page, 'toHaveTitle', ctx, o, pyStrArg(expected), () => normalizeWhitespace(page._doc?.title ?? ''), (v) => (expected instanceof RegExp ? expected.test(v) : v === normalizeWhitespace(expected)));
    },
  };
}

export function responseMatchers(res: APIResponse, ctx: Ctx) {
  return {
    toBeOK: () => {
      const r = rt();
      const where = callerLocation();
      const started = performance.now();
      const py = (ctx.isNot ? 'not_' : '') + 'to_be_ok';
      const step = r.startStep(`Expect "${py}"`, 'expect', where?.line);
      const ok = res.ok();
      if (ok === ctx.isNot) {
        const msg = ctx.isNot
          ? `${ctx.message ?? 'Response status expected not to be within [200..299] range'}, was '${res.status()}'`
          : `${ctx.message ?? 'Response status expected to be within [200..299] range'}, was '${res.status()}'\nResponse body: ${res._bodyText()}`;
        const err = new EmuError('expect-generic', msg, { matcher: py, expected: '2xx', received: String(res.status()), not: ctx.isNot ? 'not ' : '' });
        if (where) { err.line = where.line; err.file = where.file; }
        r.endStep(step, started, err);
        throw err;
      }
      r.endStep(step, started);
      return Promise.resolve();
    },
  };
}
