// expect(): web-first assertions with retries for Locator/Page, Jest-like matchers for values.
import { isChecked, isDisabled, isEditable, isVisible } from './aria';
import { EmuError, callerLocation } from './errors';
import { fmtValue, normalizeWhitespace, previewElement } from './format';
import { BASE_URL, Locator, Page } from './page';
import { describeParts } from './selectors';
import type { Pending, TestRuntime } from './runtime';
import { APIResponse } from './api';

export const current: { rt: TestRuntime | null } = { rt: null };

function rt(): TestRuntime {
  if (!current.rt) throw new EmuError('expect-outside-test', 'expect: can only be called inside a test', {});
  return current.rt;
}

interface Ctx {
  isNot: boolean;
  soft: boolean;
  message?: string;
}

type Eval = { pass: boolean; received: string; log?: string; notFound?: boolean; quoted?: boolean };

const WEB_FIRST_LOCATOR = [
  'toBeVisible', 'toBeHidden', 'toBeEnabled', 'toBeDisabled', 'toBeChecked', 'toBeEditable', 'toBeEmpty',
  'toBeFocused', 'toBeAttached', 'toHaveText', 'toContainText', 'toHaveValue', 'toHaveValues', 'toHaveAttribute',
  'toHaveClass', 'toHaveCount', 'toHaveId', 'toHaveAccessibleName', 'toHaveCSS', 'toBeInViewport',
];
const WEB_FIRST_PAGE = ['toHaveURL', 'toHaveTitle'];

function fmtExpected(v: unknown) {
  return v instanceof RegExp ? String(v) : Array.isArray(v) ? fmtValue(v) : JSON.stringify(v);
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

function matcherHeader(target: 'locator' | 'page' | 'received', name: string, isNot: boolean, hasArg: boolean) {
  return `expect(${target}).${isNot ? 'not.' : ''}${name}(${hasArg ? 'expected' : ''}) failed`;
}

/** Retrying assertion against a Locator. */
function locatorAssertion(
  loc: Locator,
  name: string,
  ctx: Ctx,
  opts: { timeout?: number } | undefined,
  expectedLine: string,
  hasArg: boolean,
  evaluate: (els: Element[]) => Eval,
  multi = false,
): Pending<void> {
  const r = rt();
  const where = callerLocation();
  const desc = describeParts(loc._parts);
  return r.api(`Expect "${ctx.isNot ? 'not ' : ''}${name}"`, 'expect', where, async () => {
    const timeout = opts?.timeout ?? r.expectTimeout;
    const deadline = performance.now() + timeout;
    let last: Eval | undefined;
    let lastPreview = '';
    let lastValue = '';
    let repeats = 0;
    const log: string[] = [`  - Expect "${name}" with timeout ${timeout}ms`, `  - waiting for ${desc}`];
    const flush = () => {
      if (!repeats || !lastPreview) return;
      log.push(`    ${repeats > 1 ? `${repeats} × ` : ''}locator resolved to ${lastPreview}`, `      - unexpected value ${JSON.stringify(lastValue)}`);
    };
    let highlighted = false;
    for (;;) {
      r.checkAlive();
      const els = loc._resolve();
      if (!multi && els.length > 1) throw loc._strictError(`expect.${name}`, els);
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
    const lines = [
      matcherHeader('locator', name, ctx.isNot, hasArg),
      '',
      `Locator:  ${desc}`,
      `Expected: ${ctx.isNot ? 'not ' : ''}${expectedLine}`,
      `Received: ${notFound ? '<element(s) not found>' : last?.quoted ? JSON.stringify(last.received) : last?.received}`,
      `Timeout:  ${timeout}ms`,
      '',
      'Call log:',
      ...log,
    ];
    const code = notFound ? 'expect-not-found' : name === 'toHaveCount' ? 'expect-count' : 'expect-failed';
    throw new EmuError(code, (ctx.message ? ctx.message + '\n\n' : '') + lines.join('\n'), {
      matcher: name, locator: desc, expected: `${ctx.isNot ? 'not ' : ''}${expectedLine}`, received: notFound ? '<element(s) not found>' : last?.received ?? '', not: ctx.isNot ? 'not ' : '',
    });
  });
}

function single(els: Element[]): Element | undefined {
  return els[0];
}

function stateMatcher(loc: Locator, name: string, ctx: Ctx, opts: Record<string, unknown> | undefined, yes: string, no: string, test: (el: Element) => boolean, missingIsPass = false) {
  return locatorAssertion(loc, name, ctx, opts as { timeout?: number }, yes, false, (els) => {
    const el = single(els);
    if (!el) return { pass: missingIsPass, received: missingIsPass ? yes : '<element(s) not found>', notFound: !missingIsPass };
    const ok = test(el);
    return { pass: ok, received: ok ? yes : no };
  });
}

function locatorMatchers(loc: Locator, ctx: Ctx) {
  return {
    toBeVisible: (o?: { timeout?: number; visible?: boolean }) => {
      const want = o?.visible ?? true;
      return stateMatcher(loc, 'toBeVisible', ctx, o, want ? 'visible' : 'hidden', want ? 'hidden' : 'visible', (el) => isVisible(el) === want);
    },
    toBeHidden: (o?: { timeout?: number }) => stateMatcher(loc, 'toBeHidden', ctx, o, 'hidden', 'visible', (el) => !isVisible(el), true),
    toBeEnabled: (o?: { timeout?: number; enabled?: boolean }) => {
      const want = o?.enabled ?? true;
      return stateMatcher(loc, 'toBeEnabled', ctx, o, want ? 'enabled' : 'disabled', want ? 'disabled' : 'enabled', (el) => !isDisabled(el) === want);
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
      return locatorAssertion(loc, 'toBeAttached', ctx, o, want ? 'attached' : 'detached', false, (els) => {
        const attached = els.length > 0;
        return { pass: attached === want, received: attached ? 'attached' : 'detached' };
      });
    },
    toBeInViewport: (o?: { timeout?: number }) => stateMatcher(loc, 'toBeInViewport', ctx, o, 'in viewport', 'outside viewport', (el) => {
      const r = el.getBoundingClientRect();
      const w = el.ownerDocument.defaultView!;
      return r.bottom > 0 && r.right > 0 && r.top < w.innerHeight && r.left < w.innerWidth;
    }),
    toHaveText: (expected: unknown, o?: { timeout?: number; useInnerText?: boolean; ignoreCase?: boolean }) => {
      if (Array.isArray(expected)) {
        return locatorAssertion(loc, 'toHaveText', ctx, o, fmtValue(expected), true, (els) => {
          const texts = els.map((e) => textOf(e, o?.useInnerText));
          const pass = texts.length === expected.length && texts.every((t, i) => strMatch(t, expected[i], 'full', o?.ignoreCase));
          return { pass, received: fmtValue(texts), notFound: !els.length };
        }, true);
      }
      const label = expected instanceof RegExp ? `${String(expected)}` : JSON.stringify(normalizeWhitespace(String(expected)));
      return locatorAssertion(loc, 'toHaveText', ctx, o, label, true, (els) => {
        const el = single(els);
        if (!el) return { pass: false, received: '', notFound: true };
        const t = textOf(el, o?.useInnerText);
        return { pass: strMatch(t, expected, 'full', o?.ignoreCase), received: t, quoted: true };
      });
    },
    toContainText: (expected: unknown, o?: { timeout?: number; useInnerText?: boolean; ignoreCase?: boolean }) => {
      if (Array.isArray(expected)) {
        return locatorAssertion(loc, 'toContainText', ctx, o, fmtValue(expected), true, (els) => {
          const texts = els.map((e) => textOf(e, o?.useInnerText));
          let i = 0;
          for (const t of texts) if (i < expected.length && strMatch(t, expected[i], 'contain', o?.ignoreCase)) i++;
          return { pass: i === expected.length, received: fmtValue(texts), notFound: !els.length };
        }, true);
      }
      const label = expected instanceof RegExp ? String(expected) : JSON.stringify(normalizeWhitespace(String(expected)));
      return locatorAssertion(loc, 'toContainText', ctx, o, label, true, (els) => {
        const el = single(els);
        if (!el) return { pass: false, received: '', notFound: true };
        const t = textOf(el, o?.useInnerText);
        return { pass: strMatch(t, expected, 'contain', o?.ignoreCase), received: t, quoted: true };
      });
    },
    toHaveValue: (expected: unknown, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveValue', ctx, o, fmtExpected(expected), true, (els) => {
      let el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      if (el.tagName.toLowerCase() === 'label') el = (el as HTMLLabelElement).control || el;
      const v = (el as HTMLInputElement).value ?? '';
      return { pass: expected instanceof RegExp ? expected.test(v) : v === String(expected), received: v, quoted: true };
    }),
    toHaveValues: (expected: unknown[], o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveValues', ctx, o, fmtValue(expected), true, (els) => {
      const el = single(els) as HTMLSelectElement | undefined;
      if (!el) return { pass: false, received: '', notFound: true };
      const vals = Array.from(el.selectedOptions || []).map((x) => x.value);
      return { pass: vals.length === expected.length && vals.every((v, i) => expected[i] instanceof RegExp ? (expected[i] as RegExp).test(v) : v === expected[i]), received: fmtValue(vals) };
    }),
    toHaveAttribute: (attr: string, expected?: unknown, o?: { timeout?: number }) => {
      if (expected === undefined || (typeof expected === 'object' && !(expected instanceof RegExp))) {
        return locatorAssertion(loc, 'toHaveAttribute', ctx, expected as { timeout?: number }, `have attribute "${attr}"`, true, (els) => {
          const el = single(els);
          if (!el) return { pass: false, received: '', notFound: true };
          const has = el.hasAttribute(attr);
          return { pass: has, received: has ? `have attribute "${attr}"` : `not have attribute "${attr}"` };
        });
      }
      return locatorAssertion(loc, 'toHaveAttribute', ctx, o, fmtExpected(expected), true, (els) => {
        const el = single(els);
        if (!el) return { pass: false, received: '', notFound: true };
        const v = el.getAttribute(attr);
        return { pass: v !== null && (expected instanceof RegExp ? expected.test(v) : v === String(expected)), received: v === null ? 'null' : v, quoted: v !== null };
      });
    },
    toHaveClass: (expected: unknown, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveClass', ctx, o, fmtExpected(expected), true, (els) => {
      const el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      const c = el.getAttribute('class') || '';
      return { pass: expected instanceof RegExp ? expected.test(c) : normalizeWhitespace(c) === normalizeWhitespace(String(expected)), received: c, quoted: true };
    }),
    toContainClass: (expected: string, o?: { timeout?: number }) => locatorAssertion(loc, 'toContainClass', ctx, o, JSON.stringify(expected), true, (els) => {
      const el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      const c = el.getAttribute('class') || '';
      return { pass: expected.split(/\s+/).every((x) => el.classList.contains(x)), received: c };
    }),
    toHaveId: (expected: unknown, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveId', ctx, o, fmtExpected(expected), true, (els) => {
      const el = single(els);
      if (!el) return { pass: false, received: '', notFound: true };
      return { pass: expected instanceof RegExp ? expected.test(el.id) : el.id === expected, received: el.id, quoted: true };
    }),
    toHaveCount: (expected: number, o?: { timeout?: number }) => locatorAssertion(loc, 'toHaveCount', ctx, o, String(expected), true, (els) => ({ pass: els.length === expected, received: String(els.length) }), true),
  };
}

function pageAssertion(page: Page, name: string, ctx: Ctx, opts: { timeout?: number } | undefined, expectedLine: string, get: () => string, test: (v: string) => boolean): Pending<void> {
  const r = rt();
  const where = callerLocation();
  return r.api(`Expect "${ctx.isNot ? 'not ' : ''}${name}"`, 'expect', where, async () => {
    const timeout = opts?.timeout ?? r.expectTimeout;
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
    const lines = [
      matcherHeader('page', name, ctx.isNot, true),
      '',
      `Expected: ${ctx.isNot ? 'not ' : ''}${expectedLine}`,
      `Received: ${JSON.stringify(value)}`,
      `Timeout:  ${timeout}ms`,
      '',
      'Call log:',
      `  - Expect "${name}" with timeout ${timeout}ms`,
      `    ${repeats} × unexpected value ${JSON.stringify(value)}`,
    ];
    void page;
    throw new EmuError(name === 'toHaveURL' ? 'expect-url' : 'expect-failed', (ctx.message ? ctx.message + '\n\n' : '') + lines.join('\n'), {
      matcher: name, expected: expectedLine, received: value, not: ctx.isNot ? 'not ' : '', locator: 'page',
    });
  });
}

function pageMatchers(page: Page, ctx: Ctx) {
  return {
    toHaveURL: (expected: string | RegExp, o?: { timeout?: number }) => {
      let want: string | RegExp = expected;
      if (typeof expected === 'string') {
        try { want = new URL(expected, BASE_URL).href; } catch { want = expected; }
      }
      const line = want instanceof RegExp ? String(want) : JSON.stringify(want);
      return pageAssertion(page, 'toHaveURL', ctx, o, line, () => page.url(), (v) => (want instanceof RegExp ? want.test(v) : v === want));
    },
    toHaveTitle: (expected: string | RegExp, o?: { timeout?: number }) => {
      const line = expected instanceof RegExp ? String(expected) : JSON.stringify(expected);
      return pageAssertion(page, 'toHaveTitle', ctx, o, line, () => normalizeWhitespace(page._doc?.title ?? ''), (v) => (expected instanceof RegExp ? expected.test(v) : v === normalizeWhitespace(expected)));
    },
  };
}

// ---------- generic (non-retrying) matchers ----------

function deepEqual(a: unknown, b: unknown, strict = false): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  const ka = Object.keys(a as object).filter((k) => strict || (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => strict || (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], strict));
}

function matchObject(a: unknown, b: unknown): boolean {
  if (typeof b !== 'object' || b === null) return deepEqual(a, b);
  if (typeof a !== 'object' || a === null) return false;
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((x, i) => matchObject(a[i], x));
  return Object.keys(b).every((k) => matchObject((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function getPath(obj: unknown, path: string | string[]): { found: boolean; value: unknown } {
  const parts = Array.isArray(path) ? path : path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || !(p in Object(cur))) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[p];
  }
  return { found: true, value: cur };
}

type GenericFn = (received: unknown, ...args: unknown[]) => { pass: boolean; expected?: string; received?: string; note?: string; noArg?: boolean };

const GENERIC: Record<string, GenericFn> = {
  toBe: (r, e) => ({ pass: Object.is(r, e), expected: fmtValue(e), note: ' // Object.is equality' }),
  toEqual: (r, e) => ({ pass: deepEqual(r, e), expected: fmtValue(e), note: ' // deep equality' }),
  toStrictEqual: (r, e) => ({ pass: deepEqual(r, e, true), expected: fmtValue(e), note: ' // deep equality' }),
  toBeTruthy: (r) => ({ pass: !!r, noArg: true }),
  toBeFalsy: (r) => ({ pass: !r, noArg: true }),
  toBeNull: (r) => ({ pass: r === null, noArg: true }),
  toBeUndefined: (r) => ({ pass: r === undefined, noArg: true }),
  toBeDefined: (r) => ({ pass: r !== undefined, noArg: true }),
  toBeNaN: (r) => ({ pass: typeof r === 'number' && isNaN(r), noArg: true }),
  toContain: (r, e) => ({ pass: typeof r === 'string' ? r.includes(String(e)) : Array.isArray(r) ? r.includes(e) : false, expected: fmtValue(e) }),
  toContainEqual: (r, e) => ({ pass: Array.isArray(r) && r.some((x) => deepEqual(x, e)), expected: fmtValue(e) }),
  toHaveLength: (r, e) => ({ pass: !!r && (r as { length?: number }).length === e, expected: String(e), received: r && (r as { length?: number }).length !== undefined ? String((r as { length: number }).length) : fmtValue(r) }),
  toHaveProperty: (r, path, ...rest) => {
    const { found, value } = getPath(r, path as string);
    const pass = rest.length ? found && deepEqual(value, rest[0]) : found;
    return { pass, expected: rest.length ? `${fmtValue(path)}: ${fmtValue(rest[0])}` : `property ${fmtValue(path)}`, received: found ? fmtValue(value) : 'undefined' };
  },
  toMatch: (r, e) => ({ pass: typeof r === 'string' && (e instanceof RegExp ? e.test(r) : r.includes(String(e))), expected: e instanceof RegExp ? String(e) : fmtValue(e) }),
  toMatchObject: (r, e) => ({ pass: matchObject(r, e), expected: fmtValue(e) }),
  toBeGreaterThan: (r, e) => ({ pass: (r as number) > (e as number), expected: `> ${e}` }),
  toBeGreaterThanOrEqual: (r, e) => ({ pass: (r as number) >= (e as number), expected: `>= ${e}` }),
  toBeLessThan: (r, e) => ({ pass: (r as number) < (e as number), expected: `< ${e}` }),
  toBeLessThanOrEqual: (r, e) => ({ pass: (r as number) <= (e as number), expected: `<= ${e}` }),
  toBeCloseTo: (r, e, digits = 2) => ({ pass: Math.abs((r as number) - (e as number)) < Math.pow(10, -(digits as number)) / 2, expected: String(e) }),
  toBeInstanceOf: (r, e) => ({ pass: typeof e === 'function' && r instanceof (e as new () => unknown), expected: (e as { name?: string })?.name || String(e) }),
  toThrow: (r, e) => {
    if (typeof r !== 'function') return { pass: false, expected: 'a function', received: fmtValue(r) };
    try { (r as () => void)(); return { pass: false, expected: e === undefined ? 'to throw' : fmtValue(e), received: 'did not throw' }; } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      const pass = e === undefined || (e instanceof RegExp ? e.test(msg) : typeof e === 'string' ? msg.includes(e) : true);
      return { pass, expected: e === undefined ? 'to throw' : fmtValue(e), received: JSON.stringify(msg) };
    }
  },
};

function genericFailure(name: string, ctx: Ctx, received: unknown, res: ReturnType<GenericFn>): EmuError {
  const header = `expect(received).${ctx.isNot ? 'not.' : ''}${name}(${res.noArg ? '' : 'expected'})${res.note || ''}`;
  const lines = [header, ''];
  if (!res.noArg) lines.push(`Expected: ${ctx.isNot ? 'not ' : ''}${res.expected}`);
  lines.push(`Received: ${res.received ?? fmtValue(received)}`);
  return new EmuError('expect-generic', (ctx.message ? ctx.message + '\n\n' : '') + lines.join('\n'), {
    matcher: name, expected: `${ctx.isNot ? 'not ' : ''}${res.expected ?? ''}`, received: res.received ?? fmtValue(received), not: ctx.isNot ? 'not ' : '',
  });
}

function genericMatchers(received: unknown, ctx: Ctx) {
  const out: Record<string, (...args: unknown[]) => void> = {};
  for (const [name, fn] of Object.entries(GENERIC)) {
    out[name] = (...args: unknown[]) => {
      const r = rt();
      const where = callerLocation();
      const started = performance.now();
      const step = r.startStep(`Expect "${ctx.isNot ? 'not ' : ''}${name}"`, 'expect', where?.line);
      const res = fn(received, ...args);
      if (res.pass === ctx.isNot) {
        const err = genericFailure(name, ctx, received, res);
        if (where) { err.line = where.line; err.file = where.file; }
        r.endStep(step, started, err);
        if (ctx.soft) { r.softErrors.push({ code: err.code, message: err.message, data: err.data, line: err.line }); return; }
        throw err;
      }
      r.endStep(step, started);
    };
  }
  for (const name of [...WEB_FIRST_LOCATOR, ...WEB_FIRST_PAGE, 'toBeOK']) {
    out[name] = () => {
      const what = name === 'toBeOK' ? 'APIResponse' : WEB_FIRST_PAGE.includes(name) ? 'Page' : 'Locator';
      const err = new EmuError('matcher-wrong-target', `Error: ${name} can be only used with ${what} object`, { matcher: name, target: what, received: fmtValue(received) });
      const where = callerLocation();
      if (where) { err.line = where.line; err.file = where.file; }
      throw err;
    };
  }
  return out;
}

function responseMatchers(res: APIResponse, ctx: Ctx) {
  return {
    toBeOK: () => {
      const r = rt();
      const where = callerLocation();
      const started = performance.now();
      const step = r.startStep(`Expect "${ctx.isNot ? 'not ' : ''}toBeOK"`, 'expect', where?.line);
      const ok = res.ok();
      if (ok === ctx.isNot) {
        const err = new EmuError('expect-generic', `expect(response).${ctx.isNot ? 'not.' : ''}toBeOK()\n\nExpected status code to ${ctx.isNot ? 'not ' : ''}be in range 200-299\nReceived: ${res.status()} ${res.statusText()}\nResponse body: ${res._bodyText()}`, { matcher: 'toBeOK', expected: '2xx', received: String(res.status()), not: ctx.isNot ? 'not ' : '' });
        if (where) { err.line = where.line; err.file = where.file; }
        r.endStep(step, started, err);
        if (ctx.soft) { r.softErrors.push({ code: err.code, message: err.message, data: err.data, line: err.line }); return Promise.resolve(); }
        throw err;
      }
      r.endStep(step, started);
      return Promise.resolve();
    },
  };
}

function build(received: unknown, ctx: Ctx): Record<string, unknown> {
  let matchers: Record<string, unknown>;
  if (received instanceof Locator) matchers = { ...genericMatchers(received, ctx), ...locatorMatchers(received, ctx) };
  else if (received instanceof Page) matchers = { ...genericMatchers(received, ctx), ...pageMatchers(received, ctx) };
  else if (received instanceof APIResponse) matchers = { ...genericMatchers(received, ctx), ...responseMatchers(received, ctx) };
  else matchers = genericMatchers(received, ctx);
  if (ctx.soft) {
    // Soft web-first assertions: record the failure, don't stop the test.
    for (const [k, fn] of Object.entries(matchers)) {
      matchers[k] = (...args: unknown[]) => {
        const res = (fn as (...a: unknown[]) => unknown)(...args);
        if (res && typeof (res as PromiseLike<unknown>).then === 'function') {
          const r = rt();
          return (res as PromiseLike<unknown>).then(undefined, (err: unknown) => {
            if (err instanceof EmuError && err.code.startsWith('expect')) {
              r.softErrors.push({ code: err.code, message: err.message, data: err.data, line: err.line });
              return;
            }
            throw err;
          });
        }
        return res;
      };
    }
  }
  return matchers;
}

function makeExpect(received: unknown, message: string | undefined, soft: boolean) {
  const base = build(received, { isNot: false, soft, message });
  Object.defineProperty(base, 'not', { get: () => build(received, { isNot: true, soft, message }) });
  Object.defineProperty(base, 'resolves', { get: () => { throw new EmuError('unsupported', 'expect(...).resolves is not supported in the emulator — use await first', {}, { emulatorNote: true }); } });
  return base;
}

/** expect.poll: retries a function until a generic matcher passes. */
function makePoll(fn: () => unknown, opts: { timeout?: number; message?: string } = {}) {
  const make = (isNot: boolean) => {
    const out: Record<string, (...a: unknown[]) => Pending<void>> = {};
    for (const [name, g] of Object.entries(GENERIC)) {
      out[name] = (...args: unknown[]) => {
        const r = rt();
        const where = callerLocation();
        return r.api(`Expect poll "${name}"`, 'expect', where, async () => {
          const timeout = opts.timeout ?? r.expectTimeout;
          const deadline = performance.now() + timeout;
          let value: unknown;
          let res: ReturnType<GenericFn>;
          for (;;) {
            value = await fn();
            res = g(value, ...args);
            if (res.pass !== isNot) return;
            if (performance.now() > deadline) break;
            await r.sleep(100);
          }
          const err = genericFailure(name, { isNot, soft: false, message: opts.message }, value, res);
          err.message = `expect.poll: Timeout ${timeout}ms exceeded while waiting\n\n` + err.message;
          throw err;
        });
      };
    }
    return out;
  };
  const base: Record<string, unknown> = make(false);
  Object.defineProperty(base, 'not', { get: () => make(true) });
  return base;
}

export function createExpect() {
  const expect = (received: unknown, message?: string) => makeExpect(received, typeof message === 'string' ? message : undefined, false);
  expect.soft = (received: unknown, message?: string) => makeExpect(received, typeof message === 'string' ? message : undefined, true);
  expect.poll = (fn: () => unknown, opts?: { timeout?: number; message?: string }) => makePoll(fn, opts);
  expect.configure = () => expect;
  expect.extend = () => {
    throw new EmuError('unsupported', 'expect.extend is not supported in the emulator', {}, { emulatorNote: true });
  };
  return expect;
}
