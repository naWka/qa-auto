// Runs a pytest file: loads conftest.py and the test module, collects test functions,
// resolves fixtures (scopes, yield teardown, parametrize) and builds the report.
import { APIRequestContext, loadAutData, type AutData } from './api';
import { EmuError, setKnownFiles, setLocationProvider } from './errors';
import { current } from './expect';
import { BASE_URL, Page, type BloomlyCtx } from './page';
import { RunController, SPEC, TestRuntime } from './runtime';
import { analyze } from './static';
import type { ErrorInfo, RunResult, StaticFinding, TestResult } from './types';
import { PySyntaxError } from './py/errors';
import { Interp, isUncatchable } from './py/interp';
import { MISSING_REF, makeBuiltins, makeExceptions, makeStdlib } from './py/builtins';
import { MISSING } from './py/interp';
import {
  APIRequestContextW, BrowserW, ContextW, PageW, PlaywrightW, convertEmuError, makeExpect, playwrightModules,
} from './py/bindings';
import { ParamSet, makePytestModule, marksOf, paramId, type FixtureInfo, type Mark } from './py/pytest';
import { parseModule } from './py/parser';
import {
  PyBuiltin, PyClass, PyDict, PyException, PyFunction, PyInstance, PyModule, exceptionMessage, isTuple, repr, truthy,
  type PyHost,
} from './py/values';

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
const MODULE = 'test_example';

let queue: Promise<unknown> = Promise.resolve();

export function runSpec(opts: RunOptions): Promise<RunResult> {
  const p = queue.then(() => doRun(opts));
  queue = p.catch(() => undefined);
  return p;
}

interface FixtureDef { name: string; fn: PyFunction; info: FixtureInfo; owner: 'conftest' | 'module' | PyClass }

interface Item {
  name: string;
  nodeid: string;
  titlePath: string[];
  fn: PyFunction;
  cls?: PyClass;
  params: Map<string, unknown>;
  /** fixture params chosen for this item: fixture name → index */
  fixtureParams: Map<string, number>;
  marks: Mark[];
  line: number;
}

const BUILTIN_FIXTURES = ['page', 'context', 'browser', 'browser_name', 'browser_type', 'base_url', 'playwright', 'request', 'browser_context_args', 'browser_type_launch_args', 'is_chromium', 'is_firefox', 'is_webkit'];
const SCOPE_RANK: Record<string, number> = { function: 0, class: 1, module: 2, package: 3, session: 4 };
const BUILTIN_SCOPE: Record<string, string> = { page: 'function', context: 'function', request: 'function', browser: 'session', browser_name: 'session', browser_type: 'session', base_url: 'session', playwright: 'session', browser_context_args: 'session', browser_type_launch_args: 'session', is_chromium: 'session', is_firefox: 'session', is_webkit: 'session' };

class SetupError extends Error {
  info: ErrorInfo;
  constructor(info: ErrorInfo) { super(info.message); this.info = info; }
}

async function doRun(opts: RunOptions): Promise<RunResult> {
  const started = performance.now();
  const ctl = opts.controller;
  ctl.aborted = false;
  const mode = opts.mode ?? 'spec';
  const userFiles = opts.files ?? {};
  const files: Record<string, string> = { ...userFiles, [SPEC]: opts.code };
  setKnownFiles(Object.keys(files));
  const logs: string[] = [];
  let findings: StaticFinding[] = [];

  const finish = (r: Omit<RunResult, 'duration' | 'logs' | 'findings' | 'mode'>): RunResult => {
    setLocationProvider(null);
    current.expectTimeout = null;
    const result: RunResult = { ...r, duration: Math.round(performance.now() - started), logs, findings, mode };
    ctl.emit({ type: 'line', line: null });
    ctl.emit({ type: 'done', result });
    return result;
  };

  // ---- compile (syntax errors are collection errors) ----
  try {
    parseModule(opts.code, SPEC);
    findings = analyze(opts.code).findings;
  } catch (e) {
    if (e instanceof PySyntaxError) return finish({ status: 'error', tests: [], error: syntaxInfo(e) });
    return finish({ status: 'error', tests: [], error: { code: 'unknown', message: String(e), data: {} } });
  }

  // ---- interpreter ----
  let loopCount = 0;
  const scriptRt = new TestRuntime(ctl);
  const E = makeExceptions();
  let interp!: Interp;
  const ip = () => interp;
  const printHook = (text: string) => {
    const t = text.endsWith('\n') ? text.slice(0, -1) : text;
    for (const line of t.split('\n')) {
      logs.push(line);
      current.rt?.log(line);
    }
  };
  const sleep = (ms: number) => (current.rt ?? scriptRt).sleep(ms);
  const builtins = makeBuiltins(ip, E, { print: printHook, sleep, files });
  interp = new Interp(builtins, E, {
    print: printHook,
    loopGuard: () => {
      if (++loopCount > 200000) throw Object.assign(new EmuError('loop-guard', 'the loop ran more than 200000 times — probably an infinite loop', {}, { emulatorNote: true }), { uncatchable: true });
    },
    checkAlive: () => { (current.rt ?? scriptRt).checkAlive(); },
    convertError: (e) => convertEmuError(ip, E, e),
    files,
    builtinModule: (name) => modules[name]?.() ?? null,
  });
  MISSING_REF.v = MISSING;
  const expectFn = makeExpect(ip);
  const stdlib = makeStdlib(ip, E, { sleep, print: printHook });
  const pw = playwrightModules(ip, E, expectFn);
  const moduleCache = new Map<string, PyModule>();
  const factories: Record<string, () => PyModule> = { ...stdlib, ...pw, pytest: makePytestModule(ip) };
  const modules: Record<string, () => PyModule> = {};
  for (const [k, f] of Object.entries(factories)) modules[k] = () => { let m = moduleCache.get(k); if (!m) { m = f(); moduleCache.set(k, m); } return m; };
  // playwright.sync_api must be reachable as an attribute of `playwright`
  const pwRoot = modules.playwright();
  pwRoot.dict.set('sync_api', modules['playwright.sync_api']());
  setLocationProvider((onlyFile) => interp.location(onlyFile));

  const errInfo = (e: unknown): ErrorInfo => pyErrorInfo(interp.toPy(e), E);
  // Short snippets without any import get the usual names for free (like the JS trainer gave test/expect);
  // a file with imports is a real file and must import what it uses.
  const implicitNames = (code: string): Map<string, unknown> | undefined => {
    if (/^\s*(import|from)\s/m.test(code)) return undefined;
    const sync = modules['playwright.sync_api']();
    return new Map<string, unknown>([
      ['expect', sync.dict.get('expect')], ['Page', sync.dict.get('Page')], ['re', modules.re()], ['pytest', modules.pytest()],
    ]);
  };

  // ---- script mode: run top-level code, show print() output ----
  if (mode === 'script') {
    current.rt = scriptRt;
    try {
      await interp.runModule('__main__', SPEC, opts.code, implicitNames(opts.code));
    } catch (e) {
      current.rt = null;
      const info = isUncatchable(e) ? emuInfo(e) : errInfo(e);
      return finish({ status: 'failed', tests: [scriptResult(scriptRt, 'failed', info)], error: info });
    }
    current.rt = null;
    return finish({ status: 'passed', tests: [scriptResult(scriptRt, 'passed')] });
  }

  // ---- collect ----
  current.rt = scriptRt;
  let conftest: PyModule | null = null;
  let mod: PyModule;
  try {
    if (files['conftest.py'] !== undefined) conftest = await interp.runModule('conftest', 'conftest.py', files['conftest.py']);
    mod = await interp.runModule(MODULE, SPEC, opts.code, implicitNames(opts.code));
  } catch (e) {
    current.rt = null;
    if (isUncatchable(e)) return finish({ status: 'error', tests: [], error: emuInfo(e) });
    const info = errInfo(e);
    info.message = `ERROR collecting ${info.file ?? SPEC}\n${info.message}`;
    return finish({ status: 'error', tests: [], error: info });
  }
  current.rt = null;

  const fixtures = new Map<string, FixtureDef[]>();
  const addFixtures = (dict: Map<string, unknown>, owner: FixtureDef['owner']) => {
    for (const [key, v] of dict) {
      if (!(v instanceof PyFunction)) continue;
      const info = v.attrs.get('__fixture__') as FixtureInfo | undefined;
      if (!info) continue;
      const name = info.name ?? key;
      fixtures.set(name, [...(fixtures.get(name) ?? []), { name, fn: v, info, owner }]);
    }
  };
  if (conftest) addFixtures(conftest.dict, 'conftest');
  addFixtures(mod.dict, 'module');

  const items: Item[] = [];
  const collectErrors: ErrorInfo[] = [];
  const isTestFn = (k: string, v: unknown): v is PyFunction => v instanceof PyFunction && k.startsWith('test') && !v.attrs.has('__fixture__');
  for (const [key, v] of mod.dict) {
    if (isTestFn(key, v)) {
      try { items.push(...expand(v, undefined, [key])); } catch (e) { collectErrors.push(errInfo(e)); }
    } else if (v instanceof PyClass && key.startsWith('Test') && v.module === MODULE) {
      if (v.dict.has('__init__')) continue; // pytest skips classes with __init__ (with a warning)
      addFixtures(v.dict, v);
      for (const [mk, mv] of v.dict) {
        if (isTestFn(mk, mv)) {
          try { items.push(...expand(mv, v, [key, mk])); } catch (e) { collectErrors.push(errInfo(e)); }
        }
      }
    }
  }

  function fixtureFor(name: string, cls?: PyClass): FixtureDef | undefined {
    const defs = fixtures.get(name);
    if (!defs) return undefined;
    const visible = defs.filter((d) => d.owner === 'conftest' || d.owner === 'module' || d.owner === cls);
    // class > module > conftest
    return visible.find((d) => d.owner === cls) ?? visible.find((d) => d.owner === 'module') ?? visible.find((d) => d.owner === 'conftest');
  }

  function argNames(fn: PyFunction, skipSelf: boolean): string[] {
    const list = fn.node.args.list.filter((p) => (p.kind === 'pos' || p.kind === 'kwonly') && !fn.defaults.has(p.name)).map((p) => p.name);
    return skipSelf ? list.slice(1) : list;
  }

  function autouseFor(cls?: PyClass): string[] {
    const out: string[] = [];
    for (const [name, defs] of fixtures) {
      for (const d of defs) if (d.info.autouse && (d.owner === 'conftest' || d.owner === 'module' || d.owner === cls) && !out.includes(name)) out.push(name);
    }
    return out;
  }

  /** All fixture names an item needs (transitively), for fixture parametrization. */
  function closure(names: string[], cls?: PyClass, seen = new Set<string>()): string[] {
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      const d = fixtureFor(n, cls);
      if (d) closure(argNames(d.fn, false).filter((x) => x !== 'request'), cls, seen);
    }
    return [...seen];
  }

  function expand(fn: PyFunction, cls: PyClass | undefined, path: string[]): Item[] {
    const marks = [...(cls ? marksOf(cls) : []), ...marksOf(fn)];
    const usefixtures = marks.filter((m) => m.name === 'usefixtures').flatMap((m) => m.args.map(String));
    // parametrize marks: the decorator closest to the function is applied first
    let combos: Array<{ params: Map<string, unknown>; ids: string[]; marks: Mark[]; fx: Map<string, number> }> = [{ params: new Map(), ids: [], marks: [], fx: new Map() }];
    for (const pm of marksOf(fn).filter((m) => m.name === 'parametrize')) {
      const rawNames = pm.args[0] ?? pm.kwargs.get('argnames');
      const names = typeof rawNames === 'string' ? rawNames.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(rawNames) ? (rawNames as unknown[]).map(String) : [];
      const values = (pm.args[1] ?? pm.kwargs.get('argvalues')) as unknown;
      if (!Array.isArray(values)) throw interp.err('TypeError', `parametrize: argvalues must be a list, got ${typeof values}`);
      const ids = pm.kwargs.get('ids');
      const fnArgs = fn.node.args.list.map((p) => p.name);
      for (const n of names) {
        if (!fnArgs.includes(n)) throw interp.err('ValueError', `In ${fn.name}: function uses no argument '${n}'`);
      }
      const next: typeof combos = [];
      const rows = (values as unknown[]).map((v, i) => {
        let vals: unknown[];
        let id: string | null = null;
        let rowMarks: Mark[] = [];
        if (v instanceof ParamSet) { vals = v.values; id = v.id; rowMarks = v.marks; }
        else vals = names.length === 1 ? [v] : Array.isArray(v) ? [...v] : [v];
        if (vals.length !== names.length) throw interp.err('ValueError', `${fn.name}: in "parametrize" the number of names (${names.length}):\n  ${repr(names)}\nmust be equal to the number of values (${vals.length}):\n  ${repr(v)}`);
        if (Array.isArray(ids) && ids[i] !== undefined && ids[i] !== null) id = String(ids[i]);
        return { vals, id: id ?? vals.map((x, j) => paramId(x, names[j], i)).join('-'), marks: rowMarks };
      });
      for (const c of combos) {
        for (const row of rows) {
          const params = new Map(c.params);
          names.forEach((n, j) => params.set(n, row.vals[j]));
          next.push({ params, ids: [...c.ids, row.id], marks: [...c.marks, ...row.marks], fx: c.fx });
        }
      }
      combos = next;
      if (!rows.length) combos = [];
    }
    // fixtures with params=[...]
    const needed = closure([...autouseFor(cls), ...usefixtures, ...argNames(fn, !!cls)], cls);
    for (const n of needed) {
      const d = fixtureFor(n, cls);
      if (!d?.info.params) continue;
      const next: typeof combos = [];
      for (const c of combos) {
        if (c.params.has(n)) { next.push(c); continue; }
        d.info.params.forEach((pv, i) => {
          const fx = new Map(c.fx);
          fx.set(n, i);
          const idList = Array.isArray(d.info.ids) ? (d.info.ids as unknown[]) : null;
          next.push({ params: c.params, ids: [...c.ids, idList?.[i] !== undefined ? String(idList[i]) : paramId(pv, n, i)], marks: c.marks, fx });
        });
      }
      combos = next;
    }
    return combos.map((c) => {
      const suffix = c.ids.length ? `[${c.ids.join('-')}]` : '';
      const name = path[path.length - 1] + suffix;
      return {
        name,
        nodeid: [SPEC, ...path.slice(0, -1), name].join('::'),
        titlePath: [SPEC, ...path.slice(0, -1), name],
        fn,
        cls,
        params: c.params,
        fixtureParams: c.fx,
        marks: [...marks, ...c.marks],
        line: fn.node.line,
      };
    });
  }

  if (!items.length) {
    if (collectErrors.length) return finish({ status: 'error', tests: [], error: { ...collectErrors[0], message: `ERROR collecting ${SPEC}\n${collectErrors[0].message}` } });
    return finish({ status: 'error', tests: [], error: { code: 'no-tests', message: 'collected 0 items\n\nno tests ran\nTest functions must start with "test": def test_user_can_log_in(page: Page): …', data: {} } });
  }

  // ---- run ----
  const data = await loadAutData(opts.autDir).catch(() => null);
  const results: TestResult[] = [];
  const sessionCache = new Map<string, unknown>();
  const sessionTeardowns: Array<() => Promise<void>> = [];
  let classCache = new Map<string, unknown>();
  let classTeardowns: Array<() => Promise<void>> = [];
  let currentClass: PyClass | undefined;
  // "server" state lives in the browser context storage; API contexts created once follow the running test
  let shared: BloomlyCtx | null = null;
  const apiEnv = (d: AutData) => ({ rt: () => current.rt ?? scriptRt, data: d, bugs: () => opts.app?.bugs ?? [], storage: () => (shared ??= makeCtx(opts.app)).storage });

  const runTeardowns = async (list: Array<() => Promise<void>>): Promise<unknown> => {
    let first: unknown;
    for (const td of list.reverse()) {
      try { await td(); } catch (e) { if (isUncatchable(e)) throw e; first ??= e; }
    }
    list.length = 0;
    return first;
  };

  for (let i = 0; i < items.length; i++) {
    if (ctl.aborted) break;
    const item = items[i];
    ctl.emit({ type: 'test-start', title: item.nodeid, index: i, total: items.length });
    if (item.cls !== currentClass) {
      if (classTeardowns.length) await runTeardowns(classTeardowns).catch(() => undefined);
      classCache = new Map();
      classTeardowns = [];
      currentClass = item.cls;
    }
    const rt = new TestRuntime(ctl);
    current.rt = rt;
    shared = null;
    const t0 = performance.now();
    let status: TestResult['status'] = 'passed';
    let error: ErrorInfo | undefined;
    let label: string | undefined;
    let skipReason: string | undefined;
    let phase: TestResult['phase'];

    const markNamed = (n: string) => item.marks.filter((m) => m.name === n);
    const skipMark = markNamed('skip')[0] ?? markNamed('skipif').find((m) => truthy(m.args[0] ?? m.kwargs.get('condition')));
    const xfailMark = markNamed('xfail')[0];
    if (skipMark) {
      status = 'skipped';
      skipReason = String(skipMark.kwargs.get('reason') ?? (skipMark.name === 'skip' ? skipMark.args[0] ?? 'unconditional skip' : 'condition is true'));
    } else if (item.fn.attrs.get('__async__')) {
      status = 'skipped';
      skipReason = 'async def functions are not natively supported.';
      label = 'ASYNC';
    } else {
      const fnCache = new Map<string, unknown>();
      const fnTeardowns: Array<() => Promise<void>> = [];
      let pageW: PageW | null = null;
      let apiW: APIRequestContextW | null = null;
      const sharedCtx = () => (shared ??= makeCtx(opts.app));

      const newApi = (headers: Record<string, string> = {}) => {
        if (!data) throw new EmuError('unknown', 'could not load Bloomly data', {});
        return new APIRequestContextW(new APIRequestContext(apiEnv(data), headers), ip);
      };
      const makePage = async (): Promise<PageW> => {
        if (pageW) return pageW;
        if (!opts.frame) throw new EmuError('no-browser', 'this task has no browser window', {}, { emulatorNote: true });
        await blankFrame(opts.frame);
        opts.onUrl?.('about:blank');
        const page = new Page(rt, { frame: opts.frame, autUrl: opts.autDir + 'index.html', ctx: sharedCtx(), onUrl: (u) => { opts.onUrl?.(u); ctl.emit({ type: 'navigate', url: u }); } });
        pageW = new PageW(page, { ip, request: () => (apiW ??= newApi()), context: () => contextW });
        return pageW;
      };
      const contextW = new ContextW(ip, () => (apiW ??= newApi()), makePage, () => (pageW ? [pageW] : []));

      const builtin = async (name: string): Promise<unknown> => {
        switch (name) {
          case 'page': return makePage();
          case 'context': return contextW;
          case 'browser': return new BrowserW(ip);
          case 'browser_name': return 'chromium';
          case 'browser_type': return modules.playwright && new PlaywrightW(ip, newApi).pyGetAttr('chromium');
          case 'base_url': return BASE_URL;
          case 'playwright': return new PlaywrightW(ip, newApi);
          case 'browser_context_args': case 'browser_type_launch_args': return new PyDict();
          case 'is_chromium': return true;
          case 'is_firefox': case 'is_webkit': return false;
        }
        return undefined;
      };

      const requestHost = (fixtureName: string | null, param: unknown, teardowns: Array<() => Promise<void>>): PyHost => ({
        pyType: 'SubRequest',
        pyGetAttr: (n: string) => {
          if (n === 'param') {
            if (param === MISSING) throw interp.err('AttributeError', "'SubRequest' object has no attribute 'param'");
            return param;
          }
          if (n === 'fixturename') return fixtureName;
          if (n === 'node' || n === '_pyfuncitem') return { pyType: 'Function', pyGetAttr: (k: string) => (k === 'name' ? item.name : k === 'nodeid' ? item.nodeid : k === 'originalname' ? item.fn.name : undefined) } as PyHost;
          if (n === 'function') return item.fn;
          if (n === 'cls') return item.cls ?? null;
          if (n === 'config') return { pyType: 'Config', pyGetAttr: (k: string) => (k === 'getoption' ? new PyBuiltin('getoption', (a) => (String(a[0]).replace(/^--/, '') === 'base_url' || a[0] === '--base-url' ? BASE_URL : a[1] ?? null)) : undefined) } as PyHost;
          if (n === 'addfinalizer') return new PyBuiltin('addfinalizer', (a) => { teardowns.push(async () => { await interp.call(a[0], [], new Map()); }); return null; });
          if (n === 'getfixturevalue') return new PyBuiltin('getfixturevalue', (a) => getFixture(String(a[0]), 'function', []));
          return undefined;
        },
      });

      const getFixture = async (name: string, requesterScope: string, chain: string[]): Promise<unknown> => {
        if (item.params.has(name)) return item.params.get(name);
        const def = fixtureFor(name, item.cls);
        if (!def) {
          if (name === 'request') return requestHost(null, MISSING, fnTeardowns);
          if (BUILTIN_FIXTURES.includes(name)) {
            const scope = BUILTIN_SCOPE[name] ?? 'function';
            if (SCOPE_RANK[scope] < SCOPE_RANK[requesterScope]) throw scopeMismatch(name, scope, requesterScope, chain);
            if (fnCache.has(name)) return fnCache.get(name);
            const v = await builtin(name);
            fnCache.set(name, v);
            return v;
          }
          const available = [...new Set([...BUILTIN_FIXTURES, ...fixtures.keys()])].sort();
          throw new SetupError({
            code: 'fixture-not-found',
            message: `${chain.length ? `fixture '${chain[chain.length - 1]}' requests` : `def ${item.fn.name}(...)`}\nE       fixture '${name}' not found\n>       available fixtures: ${available.join(', ')}\n>       use 'pytest --fixtures [testpath]' for help on them.`,
            data: { name, available: available.join(', ') },
            line: item.line,
          });
        }
        const scope = def.info.scope;
        if (SCOPE_RANK[scope] < SCOPE_RANK[requesterScope]) throw scopeMismatch(name, scope, requesterScope, chain);
        if (chain.includes(name)) throw new SetupError({ code: 'fixture-cycle', message: `recursive dependency involving fixture '${name}' detected`, data: { name }, line: def.fn.node.line });
        const pIndex = item.fixtureParams.get(name);
        const cacheKey = pIndex === undefined ? name : `${name}[${pIndex}]`;
        const cache = scope === 'function' ? fnCache : scope === 'class' ? classCache : sessionCache;
        const teardowns = scope === 'function' ? fnTeardowns : scope === 'class' ? classTeardowns : sessionTeardowns;
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        const kwargs = new Map<string, unknown>();
        for (const dep of argNames(def.fn, false)) {
          if (dep === 'request') kwargs.set('request', requestHost(name, pIndex === undefined ? MISSING : def.info.params![pIndex], teardowns));
          else kwargs.set(dep, await getFixture(dep, scope, [...chain, name]));
        }
        const value = await rt.group(`fixture: ${name}`, 'fixture', def.fn.node.line, () => runFixture(def, kwargs, teardowns));
        cache.set(cacheKey, value);
        return value;
      };

      const scopeMismatch = (name: string, scope: string, requester: string, chain: string[]) => new SetupError({
        code: 'scope-mismatch',
        message: `ScopeMismatch: You tried to access the ${scope} scoped fixture ${name} with a ${requester} scoped request object. Requesting fixture stack:\n${chain.map((c) => `  ${c}`).join('\n')}`,
        data: { name, scope, requester, fixture: chain[chain.length - 1] ?? '' },
        line: item.line,
      });

      const runFixture = async (def: FixtureDef, kwargs: Map<string, unknown>, teardowns: Array<() => Promise<void>>): Promise<unknown> => {
        if (!def.fn.node.isGenerator) return interp.callFunction(def.fn, [], kwargs);
        const base = interp.frames.length;
        let release!: () => void;
        const released = new Promise<void>((r) => { release = r; });
        let yielded = false;
        return new Promise((resolve, reject) => {
          const done = interp.callFunction(def.fn, [], kwargs, 0, async (v) => {
            if (yielded) throw interp.err('ValueError', `fixture function has more than one 'yield'`);
            yielded = true;
            const saved = interp.frames.splice(base);
            resolve(v);
            await released;
            interp.frames.push(...saved);
            return null;
          });
          done.then(() => {
            if (!yielded) reject(interp.err('ValueError', `${def.name} did not yield a value`));
          }, (e) => { if (!yielded) reject(e); });
          teardowns.push(async () => {
            release();
            await rt.group(`fixture teardown: ${def.name}`, 'fixture', def.fn.node.line, async () => { await done; });
          });
        });
      };

      const body = async () => {
        // setup: autouse fixtures, usefixtures, then the test's own arguments
        const kwargs = new Map<string, unknown>();
        try {
          for (const n of autouseFor(item.cls)) await getFixture(n, 'function', []);
          for (const m of item.marks.filter((x) => x.name === 'usefixtures')) for (const n of m.args) await getFixture(String(n), 'function', []);
          for (const n of argNames(item.fn, !!item.cls)) kwargs.set(n, await getFixture(n, 'function', []));
        } catch (e) {
          phase = 'setup';
          throw e;
        }
        if (item.cls) {
          const inst = await interp.instantiate(item.cls, [], new Map()) as PyInstance;
          const setup = item.cls.lookup('setup_method');
          if (setup instanceof PyFunction) await interp.callFunction(setup, [inst, item.fn], new Map(), 1);
          try {
            await interp.callFunction(item.fn, [inst], kwargs, 1);
          } finally {
            const td = item.cls.lookup('teardown_method');
            if (td instanceof PyFunction) await interp.callFunction(td, [inst, item.fn], new Map(), 1);
          }
        } else {
          await interp.callFunction(item.fn, [], kwargs);
        }
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          body(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new EmuError('test-timeout', `Test timeout of ${TEST_TIMEOUT}ms exceeded.`, { timeout: TEST_TIMEOUT }, { emulatorNote: true })), TEST_TIMEOUT); }),
        ]);
      } catch (e) {
        if (e instanceof SetupError) { status = 'failed'; error = e.info; phase = 'setup'; label = 'ERROR'; }
        else if (phase === 'setup' && e instanceof EmuError && e.code === 'no-browser') { status = 'failed'; error = { ...emuInfo(e), line: item.line }; label = 'ERROR'; }
        else if (e instanceof EmuError && e.code === 'test-timeout') { status = 'timedOut'; error = emuInfo(e); }
        else if (e instanceof EmuError && (e.code === 'closed' || e.code === 'loop-guard')) { status = 'failed'; error = emuInfo(e); }
        else {
          const pe = interp.toPy(e);
          const cls = pe.cls.name;
          if (cls === 'Skipped') { status = 'skipped'; skipReason = exceptionMessage(pe.exc); }
          else if (cls === 'XFailed') { status = 'skipped'; label = 'XFAIL'; skipReason = exceptionMessage(pe.exc); }
          else {
            status = 'failed';
            error = pyErrorInfo(pe, E);
            if (phase === 'setup') { label = 'ERROR'; error.line ??= item.line; }
          }
        }
      } finally {
        clearTimeout(timer);
      }

      // teardown of function-scoped fixtures
      try {
        const tdErr = await runTeardowns(fnTeardowns);
        if (tdErr && status === 'passed') { status = 'failed'; error = errInfo(tdErr); phase = 'teardown'; label = 'ERROR'; }
      } catch (e) {
        if (status === 'passed') { status = 'failed'; error = emuInfo(e); }
      }
      const pageObj = pageW as PageW | null;
      if (pageObj) pageObj.page._hideHighlight();

      if (xfailMark && status !== 'skipped' && label !== 'ERROR') {
        const reason = String(xfailMark.kwargs.get('reason') ?? xfailMark.args[1] ?? '');
        const strict = truthy(xfailMark.kwargs.get('strict') ?? false);
        if (status === 'failed' || status === 'timedOut') { status = 'skipped'; label = 'XFAIL'; skipReason = reason; error = undefined; }
        else if (status === 'passed') {
          if (strict) { status = 'failed'; label = 'XPASS(strict)'; error = { code: 'xpass-strict', message: `[XPASS(strict)] ${reason}`, data: { reason } }; }
          else label = 'XPASS';
        }
      }
    }

    // session / class teardown after the last test
    if (i === items.length - 1 || ctl.aborted) {
      try {
        const e1 = await runTeardowns(classTeardowns);
        const e2 = await runTeardowns(sessionTeardowns);
        const tdErr = e1 ?? e2;
        if (tdErr && status === 'passed') { status = 'failed'; error = errInfo(tdErr); phase = 'teardown'; label = 'ERROR'; }
      } catch { /* closed */ }
    }

    rt.close();
    current.rt = null;
    const result: TestResult = {
      title: item.name,
      titlePath: item.titlePath,
      nodeid: item.nodeid,
      status,
      duration: Math.round(performance.now() - t0),
      steps: rt.steps,
      error,
      softErrors: [],
      logs: rt.logs,
      label,
      skipReason,
      phase,
    };
    results.push(result);
    ctl.emit({ type: 'test-end', result });
  }

  if (ctl.aborted) return finish({ status: 'aborted', tests: results });
  const failed = results.some((r) => r.status === 'failed' || r.status === 'timedOut');
  return finish({ status: failed ? 'failed' : 'passed', tests: results });
}

// ---------- error reports ----------

function syntaxInfo(e: PySyntaxError): ErrorInfo {
  return {
    code: e.kind === 'IndentationError' ? 'indentation' : 'syntax',
    message: `${e.kind}: ${e.message} (${e.file}, line ${e.line})`,
    data: { message: e.message, line: e.line },
    line: e.line,
    file: e.file === SPEC ? undefined : e.file,
  };
}

function emuInfo(e: unknown): ErrorInfo {
  if (e instanceof EmuError) return { code: e.code, message: `Error: ${e.message}`, data: e.data, line: e.line, file: e.file, emulatorNote: e.emulatorNote };
  return { code: 'unknown', message: String(e), data: {} };
}

/** Full class name as pytest prints it on the "E" line. */
function qualName(cls: PyClass, E: Record<string, PyClass>): string {
  if (cls === E.PlaywrightError) return 'playwright._impl._errors.Error';
  if (cls === E.PlaywrightTimeoutError) return 'playwright._impl._errors.TimeoutError';
  if (cls === E.JSONDecodeError) return 'json.decoder.JSONDecodeError';
  if (['Skipped', 'Failed', 'XFailed'].includes(cls.name)) return cls.name;
  return cls.module === 'builtins' || cls.module === MODULE || cls.module === '__main__' ? cls.name : `${cls.module}.${cls.name}`;
}

export function pyErrorInfo(pe: PyException, E: Record<string, PyClass>): ErrorInfo {
  const msg = exceptionMessage(pe.exc);
  const message = msg ? `${qualName(pe.cls, E)}: ${msg}` : qualName(pe.cls, E);
  // innermost frame of student code
  const tb = pe.tb.filter((f) => f.file);
  const inner = tb[tb.length - 1];
  const specFrame = [...tb].reverse().find((f) => f.file === SPEC);
  let line = inner?.line;
  let file = inner && inner.file !== SPEC ? inner.file : undefined;
  if (pe.cls.name === 'SyntaxError' || pe.cls.name === 'IndentationError') {
    line = Number(pe.exc.dict.get('lineno') ?? line);
    const f = String(pe.exc.dict.get('filename') ?? '');
    file = f && f !== SPEC ? f : undefined;
  }
  const info: ErrorInfo = {
    code: pe.emu?.code ?? codeFor(pe, msg),
    message: pe.emu && pe.cls.name !== 'AssertionError' ? `${qualName(pe.cls, E)}: ${pe.emu.message}` : message,
    data: pe.emu?.data ?? dataFor(pe, msg),
    line,
    file,
    emulatorNote: pe.emu?.emulatorNote,
  };
  if (pe.emu && pe.cls.name === 'AssertionError') info.message = `AssertionError: ${pe.emu.message.replace(/^AssertionError: /, '')}`;
  if (file && specFrame) info.specLine = specFrame.line;
  return info;
}

function codeFor(pe: PyException, msg: string): string {
  switch (pe.cls.name) {
    case 'NameError': return 'name-error';
    case 'AttributeError': return /^'NoneType'/.test(msg) ? 'none-attribute' : 'attribute-error';
    case 'TypeError':
      if (/object is not callable/.test(msg)) return 'not-callable';
      if (/missing \d+ required/.test(msg)) return 'missing-argument';
      if (/unexpected keyword argument/.test(msg)) return 'unexpected-keyword';
      if (/takes .* positional argument/.test(msg)) return 'too-many-args';
      if (/can only concatenate str/.test(msg)) return 'str-concat';
      if (/object is not subscriptable/.test(msg)) return 'not-subscriptable';
      if (/object is not iterable/.test(msg)) return 'not-iterable';
      return 'type-error';
    case 'KeyError': return 'key-error';
    case 'IndexError': return 'index-error';
    case 'ValueError':
      if (/could not convert string to float/.test(msg)) return 'float-parse';
      if (/invalid literal for int/.test(msg)) return 'int-parse';
      if (/values to unpack/.test(msg)) return 'unpack';
      return 'value-error';
    case 'ZeroDivisionError': return 'zero-division';
    case 'SyntaxError': return 'syntax';
    case 'IndentationError': return 'indentation';
    case 'ModuleNotFoundError': return 'module-not-found';
    case 'ImportError': return 'import-error';
    case 'RecursionError': return 'recursion';
    case 'JSONDecodeError': return 'json-decode';
    case 'FileNotFoundError': return 'file-not-found';
    case 'AssertionError': return 'assert-failed';
    case 'Failed': return 'pytest-failed';
  }
  return 'exception';
}

function dataFor(pe: PyException, msg: string): Record<string, string | number> {
  const d: Record<string, string | number> = { type: pe.cls.name, message: msg };
  let m = /name '(\w+)' is not defined/.exec(msg);
  if (m) d.name = m[1];
  m = /'(\w+)' object has no attribute '(\w+)'(?:\. Did you mean: '(\w+)'\?)?/.exec(msg);
  if (m) { d.target = m[1]; d.attr = m[2]; d.suggestion = m[3] ?? ''; }
  m = /module '([\w.]+)' has no attribute '(\w+)'/.exec(msg);
  if (m) { d.target = m[1]; d.attr = m[2]; }
  m = /'(\w+)' object is not (callable|subscriptable|iterable)/.exec(msg);
  if (m) d.target = m[1];
  m = /^([\w.]+)\(\) (missing|got an unexpected keyword argument '(\w+)')/.exec(msg);
  if (m) { d.fn = m[1]; d.kw = m[3] ?? ''; }
  m = /No module named '([\w.]+)'/.exec(msg);
  if (m) d.module = m[1];
  if (pe.cls.name === 'KeyError') d.key = msg;
  return d;
}

function scriptResult(rt: TestRuntime, status: 'passed' | 'failed', error?: ErrorInfo): TestResult {
  return { title: 'script', titlePath: ['script'], nodeid: 'script', status, duration: 0, steps: rt.steps, error, softErrors: [], logs: rt.logs };
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

void isTuple;
void PyInstance;
