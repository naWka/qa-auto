// Runs a spec file: collects tests, resolves fixtures, executes hooks and tests, builds the report.
import * as acorn from 'acorn';
import { APIRequestContext, loadAutData } from './api';
import { EmuError, WRAPPER_LINES, setKnownFiles, toErrorInfo } from './errors';
import { createExpect, current } from './expect';
import { fmtValue } from './format';
import { BASE_URL, Page, type BloomlyCtx } from './page';
import { RunController, SPEC, TestRuntime } from './runtime';
import { analyze } from './static';
import { transform } from './transform';
import type { ErrorInfo, RunResult, StaticFinding, TestResult } from './types';

export interface AppSetup {
  bugs?: string[];
  latency?: Record<string, number | [number, number]>;
  cookieBanner?: boolean;
  variant?: string;
  state?: { user?: string; cart?: { id: string; qty: number }[]; promo?: string };
}

export interface RunOptions {
  code: string;
  files?: Record<string, string>;
  mode?: 'spec' | 'script';
  frame: HTMLIFrameElement | null;
  app?: AppSetup;
  controller: RunController;
  autDir: string;
  onUrl?: (url: string) => void;
}

const TEST_TIMEOUT = 20000;

type Fn = (...args: unknown[]) => unknown;

interface FixtureDef { fn?: Fn; value?: unknown; builtin?: string }
type Layer = Record<string, FixtureDef>;

interface Suite {
  title: string;
  parent?: Suite;
  hooks: { beforeEach: Hook[]; afterEach: Hook[]; beforeAll: Hook[]; afterAll: Hook[] };
  entries: Array<Suite | TestDef>;
  only?: boolean;
  skip?: boolean;
}
interface Hook { fn: Fn; layers: Layer[]; line?: number; title?: string }
interface TestDef {
  kind: 'test';
  title: string;
  fn: Fn;
  layers: Layer[];
  suite: Suite;
  only?: boolean;
  skip?: boolean;
  fail?: boolean;
  line?: number;
}

class SkipSignal extends Error {}

function lineOfCaller(): number | undefined {
  const m = new Error().stack?.match(/example\.spec\.js:(\d+):\d+/);
  return m ? Number(m[1]) - WRAPPER_LINES : undefined;
}

/** Names destructured from the first parameter: async ({ page, request }) => … */
export function fixtureParams(fn: Fn, kind: string): string[] {
  const src = Function.prototype.toString.call(fn);
  let expr: acorn.Node & Record<string, any>;
  try {
    const prog = acorn.parse(`(${src})`, { ecmaVersion: 'latest' }) as acorn.Program & { body: any[] };
    expr = prog.body[0].expression;
  } catch {
    try {
      // class / object method shorthand: "async name({ page }) {}"
      const prog = acorn.parse(`({${src}})`, { ecmaVersion: 'latest' }) as acorn.Program & { body: any[] };
      expr = prog.body[0].expression.properties[0].value;
    } catch {
      return [];
    }
  }
  const first = expr.params?.[0];
  if (!first) return [];
  if (first.type === 'ObjectPattern') {
    return first.properties
      .filter((p: any) => p.type === 'Property')
      .map((p: any) => (p.key.type === 'Identifier' ? p.key.name : String(p.key.value)));
  }
  if (first.type === 'AssignmentPattern' && first.left.type === 'ObjectPattern') {
    return first.left.properties.filter((p: any) => p.type === 'Property').map((p: any) => p.key.name);
  }
  throw new EmuError('fixture-destructure', `${kind}: First argument must use the object destructuring pattern: ${first.name ?? 'argument'}`, { name: first.name ?? '' });
}

let queue: Promise<unknown> = Promise.resolve();

export function runSpec(opts: RunOptions): Promise<RunResult> {
  const p = queue.then(() => doRun(opts));
  queue = p.catch(() => undefined);
  return p;
}

async function doRun(opts: RunOptions): Promise<RunResult> {
  const started = performance.now();
  const ctl = opts.controller;
  ctl.aborted = false;
  const mode = opts.mode ?? 'spec';
  const files = opts.files ?? {};
  setKnownFiles([SPEC, ...Object.keys(files)]);
  const logs: string[] = [];
  let findings: StaticFinding[] = [];

  const finish = (r: Omit<RunResult, 'duration' | 'logs' | 'findings' | 'mode'>): RunResult => {
    const result: RunResult = { ...r, duration: Math.round(performance.now() - started), logs, findings, mode };
    ctl.emit({ type: 'line', line: null });
    ctl.emit({ type: 'done', result });
    return result;
  };

  // ---- compile ----
  let compiled: string;
  try {
    const t = transform(opts.code, SPEC, false);
    compiled = t.code;
    findings = analyze(opts.code, t.ast).findings;
  } catch (e) {
    return finish({ status: 'error', tests: [], error: toErrorInfo(e) });
  }

  // ---- runtime pieces shared by collection and execution ----
  const expect = createExpect();
  let loopCount = 0;
  const loopGuard = () => {
    if (++loopCount > 200000) throw new EmuError('loop-guard', 'Error: the loop ran more than 200000 times — probably an infinite loop', {}, { emulatorNote: true });
  };
  const consoleObj = makeConsole((text) => {
    logs.push(text);
    current.rt?.log(text);
  });

  const root: Suite = { title: '', hooks: { beforeEach: [], afterEach: [], beforeAll: [], afterAll: [] }, entries: [] };
  let currentSuite = root;
  let collecting = true;

  const builtins: Layer = {
    page: { builtin: 'page' }, request: { builtin: 'request' }, baseURL: { builtin: 'baseURL' }, browserName: { builtin: 'browserName' },
  };

  function makeTest(layers: Layer[]) {
    const register = (title: unknown, a: unknown, b: unknown, flags: Partial<TestDef> = {}) => {
      if (!collecting) throw new EmuError('test-inside-test', 'Error: Playwright Test did not expect test() to be called here.\nMost common reasons include:\n- You are calling test() inside another test or hook.', {});
      const fn = (typeof a === 'function' ? a : b) as Fn;
      if (typeof title !== 'string') throw new EmuError('test-title', `test(): the first argument must be a string title, got ${fmtValue(title)}`, {});
      if (typeof fn !== 'function') throw new EmuError('test-fn', `test("${title}"): the last argument must be a function`, { title });
      currentSuite.entries.push({ kind: 'test', title, fn, layers, suite: currentSuite, line: lineOfCaller(), ...flags });
    };
    const test = (title: unknown, a?: unknown, b?: unknown) => register(title, a, b);
    test.only = (title: unknown, a?: unknown, b?: unknown) => register(title, a, b, { only: true });
    test.skip = (title?: unknown, a?: unknown, b?: unknown) => {
      if (typeof title === 'string' && (typeof a === 'function' || typeof b === 'function')) return register(title, a, b, { skip: true });
      if (!collecting && (title === undefined || title === true)) throw new SkipSignal();
      if (collecting && title === undefined) currentSuite.skip = true;
    };
    test.fixme = test.skip;
    test.fail = (title: unknown, a?: unknown, b?: unknown) => register(title, a, b, { fail: true });
    test.slow = () => {};
    test.setTimeout = () => {};
    test.use = () => {};
    test.info = () => ({ title: currentTitle, retry: 0, project: { name: 'chromium' }, annotations: [] });
    const describe = (title: unknown, fn?: unknown, flags: Partial<Suite> = {}) => {
      const body = (typeof title === 'function' ? title : fn) as Fn;
      const suite: Suite = { title: typeof title === 'string' ? title : '', parent: currentSuite, hooks: { beforeEach: [], afterEach: [], beforeAll: [], afterAll: [] }, entries: [], ...flags };
      currentSuite.entries.push(suite);
      const prev = currentSuite;
      currentSuite = suite;
      try {
        const r = body();
        if (r && typeof (r as Promise<unknown>).then === 'function') throw new EmuError('describe-async', 'Error: describe() callback should not be async — test.describe collects tests synchronously.', {});
      } finally {
        currentSuite = prev;
      }
    };
    describe.only = (t: unknown, f?: unknown) => describe(t, f, { only: true });
    describe.skip = (t: unknown, f?: unknown) => describe(t, f, { skip: true });
    describe.fixme = describe.skip;
    describe.serial = Object.assign((t: unknown, f?: unknown) => describe(t, f), { only: (t: unknown, f?: unknown) => describe(t, f, { only: true }) });
    describe.parallel = describe.serial;
    describe.configure = () => {};
    test.describe = describe;
    const hook = (kind: keyof Suite['hooks']) => (a: unknown, b?: unknown) => {
      const fn = (typeof a === 'function' ? a : b) as Fn;
      currentSuite.hooks[kind].push({ fn, layers, line: lineOfCaller(), title: typeof a === 'string' ? a : undefined });
    };
    test.beforeEach = hook('beforeEach');
    test.afterEach = hook('afterEach');
    test.beforeAll = hook('beforeAll');
    test.afterAll = hook('afterAll');
    test.step = (title: string, body: Fn) => {
      const r = current.rt;
      if (!r) throw new EmuError('step-outside', 'test.step() can only be called from a test', {});
      const line = lineOfCaller();
      const rec = { title: `step ${title}`, line, awaited: false };
      r.tracked.push(rec);
      const p = r.group(title, 'test.step', line, async () => body());
      p.catch(() => {});
      return { then: (a: Fn, b: Fn) => { rec.awaited = true; return p.then(a as never, b as never); }, catch: (b: Fn) => { rec.awaited = true; return p.catch(b as never); } };
    };
    test.extend = (defs: Record<string, unknown>) => {
      const layer: Layer = {};
      for (const [k, v] of Object.entries(defs || {})) {
        if (Array.isArray(v)) layer[k] = typeof v[0] === 'function' ? { fn: v[0] as Fn } : { value: v[0] };
        else if (typeof v === 'function') layer[k] = { fn: v as Fn };
        else layer[k] = { value: v };
      }
      return makeTest([...layers, layer]);
    };
    test.expect = expect;
    return test;
  }

  const test = makeTest([builtins]);
  const moduleCache = new Map<string, Record<string, unknown>>();
  const playwrightModule = { test, expect, defineConfig: (c: unknown) => c, devices: {}, default: { test, expect } };

  const importer = (from: string) => (spec: string): Record<string, unknown> => {
    if (spec === '@playwright/test' || spec === 'playwright/test' || spec === '@playwright/test/index') return playwrightModule;
    const path = resolvePath(from, spec, files);
    if (!path) throw new EmuError('module-not-found', `Error: Cannot find module '${spec}'`, { module: spec });
    if (moduleCache.has(path)) return moduleCache.get(path)!;
    const exportsObj: Record<string, unknown> = {};
    moduleCache.set(path, exportsObj);
    const t = transform(files[path], path, true);
    const wrapped = `(function (__import, __exports, __loopGuard, console, require, module) {\n${t.code}\n})\n//# sourceURL=${path}`;
    const fn = (0, eval)(wrapped) as Fn;
    const mod = { exports: exportsObj };
    fn(importer(path), exportsObj, loopGuard, consoleObj, importer(path), mod);
    if (mod.exports !== exportsObj) Object.assign(exportsObj, mod.exports as object);
    return exportsObj;
  };

  // ---- collect ----
  let currentTitle = '';
  const scriptRt = new TestRuntime(ctl);
  try {
    const wrapped = `(async function (__rt) { const test = __rt.test, expect = __rt.expect, console = __rt.console, __import = __rt.__import, require = __rt.__import, __loopGuard = __rt.__loopGuard; {\n${compiled}\n}})\n//# sourceURL=${SPEC}`;
    const fn = (0, eval)(wrapped) as Fn;
    if (mode === 'script') current.rt = scriptRt;
    await fn({ test, expect, console: consoleObj, __import: importer(SPEC), __loopGuard: loopGuard });
  } catch (e) {
    current.rt = null;
    if (mode === 'script') {
      const info = toErrorInfo(e);
      return finish({ status: 'failed', tests: [scriptResult(scriptRt, 'failed', info)], error: info });
    }
    return finish({ status: 'error', tests: [], error: toErrorInfo(e) });
  }
  collecting = false;
  if (mode === 'script') {
    current.rt = null;
    return finish({ status: 'passed', tests: [scriptResult(scriptRt, 'passed')] });
  }

  // ---- flatten tests ----
  const all: TestDef[] = [];
  const walk = (s: Suite, skipped: boolean, only: boolean) => {
    for (const e of s.entries) {
      if ('kind' in e) all.push({ ...e, skip: e.skip || skipped || s.skip, only: e.only || only });
      else walk(e, skipped || !!s.skip || !!e.skip, only || !!e.only);
    }
  };
  walk(root, false, false);
  if (!all.length) {
    return finish({ status: 'error', tests: [], error: { code: 'no-tests', message: 'Error: No tests found.\nMake sure the file calls test(\'title\', async ({ page }) => { ... }).', data: {} } });
  }
  const hasOnly = all.some((t) => t.only);
  const toRun = hasOnly ? all.filter((t) => t.only) : all;

  const data = await loadAutData(opts.autDir).catch(() => null);
  const results: TestResult[] = [];
  const suitesStarted = new Set<Suite>();
  const remaining = new Map<Suite, number>();
  for (const t of toRun) for (let s: Suite | undefined = t.suite; s; s = s.parent) remaining.set(s, (remaining.get(s) || 0) + 1);

  for (let i = 0; i < toRun.length; i++) {
    if (ctl.aborted) break;
    const t = toRun[i];
    const titlePath = suiteTitles(t.suite).concat(t.title);
    currentTitle = t.title;
    ctl.emit({ type: 'test-start', title: titlePath.join(' › '), index: i, total: toRun.length });
    const rt = new TestRuntime(ctl);
    current.rt = rt;
    const t0 = performance.now();
    let status: TestResult['status'] = 'passed';
    let error: ErrorInfo | undefined;

    if (t.skip) {
      status = 'skipped';
    } else {
      const chain: Suite[] = [];
      for (let s: Suite | undefined = t.suite; s; s = s.parent) chain.unshift(s);
      const instances = new Map<string, unknown>();
      const teardowns: Array<() => Promise<void>> = [];
      let page: Page | null = null;
      // One "server" per test: orders and users created through the API are visible in the UI and vice versa.
      let shared: BloomlyCtx | null = null;
      const sharedCtx = () => (shared ??= makeCtx(opts.app));

      const getFixture = async (name: string, layers: Layer[], from = layers.length - 1, kind = 'test'): Promise<unknown> => {
        let idx = from;
        while (idx >= 0 && !(name in layers[idx])) idx--;
        if (idx < 0) throw new EmuError('fixture-unknown', `Error: ${kind} has unknown parameter "${name}".`, { name });
        const key = `${name}@${idx}`;
        if (instances.has(key)) return instances.get(key);
        const def = layers[idx][name];
        let value: unknown;
        if (def.builtin) {
          if (kind === 'beforeAll' || kind === 'afterAll') {
            throw new EmuError('page-in-beforeAll', `Error: "${name}" fixture is not supported in "${kind}" since it is created on a per-test basis.`, { name, hook: kind });
          }
          value = await builtinFixture(def.builtin);
        } else if ('value' in def) {
          value = def.value;
        } else {
          const deps = fixtureParams(def.fn!, `Fixture "${name}"`);
          const depObj: Record<string, unknown> = {};
          for (const d of deps) depObj[d] = await getFixture(d, layers, d === name ? idx - 1 : layers.length - 1, kind);
          value = await runFixture(name, def.fn!, depObj, teardowns, rt);
        }
        instances.set(key, value);
        return value;
      };

      const builtinFixture = async (name: string): Promise<unknown> => {
        if (name === 'baseURL') return BASE_URL;
        if (name === 'browserName') return 'chromium';
        if (name === 'request') {
          if (!data) throw new EmuError('unknown', 'Error: could not load Bloomly data', {});
          return new APIRequestContext(rt, data, opts.app?.bugs ?? [], sharedCtx().storage);
        }
        if (name === 'page') {
          if (!opts.frame) throw new EmuError('no-browser', 'Error: this task has no browser window', {}, { emulatorNote: true });
          await blankFrame(opts.frame);
          opts.onUrl?.('about:blank');
          page = new Page(rt, { frame: opts.frame, autUrl: opts.autDir + 'index.html', ctx: sharedCtx(), onUrl: (u) => { opts.onUrl?.(u); ctl.emit({ type: 'navigate', url: u }); } });
          return page;
        }
        return undefined;
      };

      const callWithFixtures = async (fn: Fn, layers: Layer[], kind: string, extra?: unknown) => {
        const names = fixtureParams(fn, kind);
        const arg: Record<string, unknown> = {};
        for (const n of names) arg[n] = await getFixture(n, layers, layers.length - 1, kind);
        return fn(arg, extra);
      };

      const body = async () => {
        for (const s of chain) {
          if (!suitesStarted.has(s)) {
            suitesStarted.add(s);
            for (const h of s.hooks.beforeAll) await rt.group('beforeAll hook', 'hook', h.line, () => callWithFixtures(h.fn, h.layers, 'beforeAll') as Promise<void>);
          }
        }
        for (const s of chain) for (const h of s.hooks.beforeEach) await rt.group(h.title ? `beforeEach hook "${h.title}"` : 'beforeEach hook', 'hook', h.line, () => callWithFixtures(h.fn, h.layers, 'beforeEach', testInfo(titlePath)) as Promise<void>);
        let testError: unknown;
        try {
          await callWithFixtures(t.fn, t.layers, 'test', testInfo(titlePath));
        } catch (e) {
          testError = e;
        }
        for (const s of [...chain].reverse()) for (const h of s.hooks.afterEach) {
          try { await rt.group('afterEach hook', 'hook', h.line, () => callWithFixtures(h.fn, h.layers, 'afterEach', testInfo(titlePath)) as Promise<void>); } catch (e) { testError = testError ?? e; }
        }
        if (testError) throw testError;
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          body(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new EmuError('test-timeout', `Test timeout of ${TEST_TIMEOUT}ms exceeded.`, { timeout: TEST_TIMEOUT }, { emulatorNote: true })), TEST_TIMEOUT); }),
        ]);
      } catch (e) {
        if (e instanceof SkipSignal) status = 'skipped';
        else {
          status = e instanceof EmuError && e.code === 'test-timeout' ? 'timedOut' : 'failed';
          error = toErrorInfo(e);
        }
      } finally {
        clearTimeout(timer);
      }

      // Forgotten await: report it explicitly (real Playwright can silently pass or fail at random).
      const floating = rt.unawaited();
      if (floating && status !== 'skipped') {
        status = 'failed';
        error = {
          code: 'missing-await',
          message: `Error: "${floating.title}" was not awaited (line ${floating.line ?? '?'}).\nThe test continued without waiting for this step to finish.`,
          data: { call: floating.title, line: floating.line ?? 0 },
          line: floating.line,
          file: floating.file,
          emulatorNote: true,
        };
      }
      if (status === 'passed' && rt.softErrors.length) {
        status = 'failed';
        error = rt.softErrors[0];
      }
      if (t.fail) {
        if (status === 'failed') { status = 'passed'; error = undefined; }
        else if (status === 'passed') { status = 'failed'; error = { code: 'expected-to-fail', message: 'Expected to fail, but passed.', data: {} }; }
      }

      for (const td of teardowns.reverse()) {
        try { await td(); } catch (e) { if (status === 'passed') { status = 'failed'; error = toErrorInfo(e); } }
      }
      const pageObj = page as Page | null;
      if (pageObj) pageObj._hideHighlight();

      // afterAll hooks for suites that have no more tests
      for (const s of [...chain].reverse()) {
        const left = (remaining.get(s) || 1) - 1;
        remaining.set(s, left);
        if (left === 0) for (const h of s.hooks.afterAll) {
          try { await rt.group('afterAll hook', 'hook', h.line, () => callWithFixtures(h.fn, h.layers, 'afterAll') as Promise<void>); } catch (e) { if (status === 'passed') { status = 'failed'; error = toErrorInfo(e); } }
        }
      }
    }

    rt.close();
    current.rt = null;
    const result: TestResult = {
      title: t.title,
      titlePath,
      status,
      duration: Math.round(performance.now() - t0),
      steps: rt.steps,
      error,
      softErrors: rt.softErrors,
      logs: rt.logs,
    };
    results.push(result);
    ctl.emit({ type: 'test-end', result });
  }

  if (ctl.aborted) return finish({ status: 'aborted', tests: results });
  const failed = results.some((r) => r.status === 'failed' || r.status === 'timedOut');
  return finish({ status: failed ? 'failed' : 'passed', tests: results });
}

function scriptResult(rt: TestRuntime, status: 'passed' | 'failed', error?: ErrorInfo): TestResult {
  return { title: 'script', titlePath: ['script'], status, duration: 0, steps: rt.steps, error, softErrors: [], logs: rt.logs };
}

function suiteTitles(s: Suite): string[] {
  const out: string[] = [];
  for (let x: Suite | undefined = s; x; x = x.parent) if (x.title) out.unshift(x.title);
  return out;
}

function testInfo(titlePath: string[]) {
  return { title: titlePath[titlePath.length - 1], titlePath, retry: 0, project: { name: 'chromium' }, annotations: [], status: 'passed' };
}

async function runFixture(name: string, fn: Fn, deps: Record<string, unknown>, teardowns: Array<() => Promise<void>>, rt: TestRuntime): Promise<unknown> {
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let gotValue = false;
  rt.checkAlive();
  return new Promise((resolve, reject) => {
    const done = (async () => {
      await fn(deps, async (value: unknown) => {
        gotValue = true;
        resolve(value);
        await released;
      });
    })();
    done.then(() => {
      if (!gotValue) reject(new EmuError('fixture-no-use', `Error: Fixture "${name}" did not call use().`, { name }));
    }, (e) => {
      if (!gotValue) reject(e);
    });
    teardowns.push(async () => {
      release();
      await done;
    });
  });
}

export function makeCtx(app?: AppSetup): BloomlyCtx {
  const storage: Record<string, string> = {};
  const st = app?.state;
  if (st?.user) storage.session = JSON.stringify(st.user);
  if (st?.cart) storage.cart = JSON.stringify(st.cart);
  if (st?.promo) storage.promo = JSON.stringify({ code: st.promo, times: 1 });
  return {
    config: { bugs: [...(app?.bugs ?? [])], latency: { ...(app?.latency ?? {}) }, cookieBanner: !!app?.cookieBanner, variant: app?.variant },
    storage,
  };
}

function blankFrame(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    frame.addEventListener('load', done, { once: true });
    try {
      frame.contentWindow!.location.replace('about:blank');
    } catch {
      frame.src = 'about:blank';
    }
    setTimeout(done, 400);
  });
}

function resolvePath(from: string, spec: string, files: Record<string, string>): string | null {
  if (!spec.startsWith('.')) return files[spec] !== undefined ? spec : null;
  const base = from.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : [];
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  const p = base.join('/');
  for (const cand of [p, `${p}.js`, `${p}.ts`, `${p}/index.js`]) if (files[cand] !== undefined) return cand;
  return null;
}

function makeConsole(sink: (text: string) => void) {
  const fmt = (args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : fmtValue(a))).join(' ');
  const log = (...args: unknown[]) => sink(fmt(args));
  return { log, info: log, warn: log, error: log, debug: log, table: log };
}
