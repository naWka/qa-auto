// Built-in functions, types, exceptions and the small part of the standard library tests use.
import { Interp, PyGenerator, isUncatchable, sortValues, suggest } from './interp';
import {
  BASE_EXCEPTION_REF, PyBoundMethod, PyBuiltin, PyClass, PyClassMethod, PyDict, PyException, PyFunction, PyInstance,
  PyMatch, PyModule, PyPattern, PyProperty, PyRange, PySet, PyStaticMethod, fromJs, isHost, isList, isTuple, pyEq, repr,
  reprStr, str, truthy, tuple, typeName, type NativeFn, type PyHost,
} from './values';
import { formatSpec } from './format';

export type Kw = Map<string, unknown>;
const fn = (name: string, f: NativeFn, owner?: string) => new PyBuiltin(name, f, owner);

// ---------- exceptions ----------

export function makeExceptions(): Record<string, PyClass> {
  const E: Record<string, PyClass> = {};
  const object = new PyClass('object');
  E.object = object;
  const def = (name: string, base: string | null, module = 'builtins') => {
    const c = new PyClass(name, base ? [E[base]] : [object], module);
    E[name] = c;
    return c;
  };
  const be = def('BaseException', null);
  BASE_EXCEPTION_REF.cls = be;
  be.dict.set('__init__', fn('__init__', (a) => { (a[0] as PyInstance).dict.set('args', a.slice(1)); return null; }));
  def('Exception', 'BaseException');
  def('KeyboardInterrupt', 'BaseException');
  def('SystemExit', 'BaseException');
  for (const n of ['ArithmeticError', 'AssertionError', 'AttributeError', 'ImportError', 'LookupError', 'NameError', 'OSError', 'RuntimeError', 'SyntaxError', 'TypeError', 'ValueError', 'StopIteration']) def(n, 'Exception');
  def('ZeroDivisionError', 'ArithmeticError');
  def('ModuleNotFoundError', 'ImportError');
  def('IndexError', 'LookupError');
  def('KeyError', 'LookupError');
  def('UnboundLocalError', 'NameError');
  def('NotImplementedError', 'RuntimeError');
  def('RecursionError', 'RuntimeError');
  def('IndentationError', 'SyntaxError');
  def('TimeoutError', 'OSError');
  def('FileNotFoundError', 'OSError');
  def('UnicodeError', 'ValueError');
  def('SystemError', 'Exception');
  def('JSONDecodeError', 'ValueError', 'json');
  // Playwright (playwright._impl._errors): Error ← TimeoutError
  def('PlaywrightError', 'Exception', 'playwright._impl._errors').name = 'Error';
  E.PlaywrightTimeoutError = new PyClass('TimeoutError', [E.PlaywrightError], 'playwright._impl._errors');
  // pytest outcomes are BaseException subclasses so `except Exception` doesn't swallow them
  def('Skipped', 'BaseException', '_pytest.outcomes');
  def('Failed', 'BaseException', '_pytest.outcomes');
  def('XFailed', 'Failed', '_pytest.outcomes');
  return E;
}

// ---------- builtins ----------

export function makeBuiltins(ip: () => Interp, E: Record<string, PyClass>, hooks: { print: (s: string) => void; sleep: (ms: number) => Promise<void>; files: Record<string, string> }): Map<string, unknown> {
  const b = new Map<string, unknown>();
  const I = () => ip();
  const err = (name: string, msg: string) => I().err(name, msg);
  const kw = (k: Kw, name: string, d: unknown = null) => (k.has(name) ? k.get(name) : d);
  const checkKw = (fname: string, k: Kw, allowed: string[]) => {
    for (const key of k.keys()) if (!allowed.includes(key)) throw err('TypeError', `${fname}() got an unexpected keyword argument '${key}'`);
  };

  // --- types ---
  const type = (name: string, check: (v: unknown) => boolean, native: NativeFn) => {
    const c = new PyClass(name, [E.object]);
    c.check = check;
    c.native = native;
    b.set(name, c);
    return c;
  };
  const toInt = (v: unknown): number => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw err(Number.isNaN(v) ? 'ValueError' : 'OverflowError', 'cannot convert float NaN to integer');
      return Math.trunc(v);
    }
    if (typeof v === 'string') {
      const s = v.trim().replace(/_/g, '');
      if (!/^[+-]?\d+$/.test(s)) throw err('ValueError', `invalid literal for int() with base 10: ${reprStr(v)}`);
      return parseInt(s, 10);
    }
    throw err('TypeError', `int() argument must be a string, a bytes-like object or a real number, not '${typeName(v)}'`);
  };
  const toFloat = (v: unknown): number => {
    if (typeof v === 'number' || typeof v === 'boolean') return Number(v);
    if (typeof v === 'string') {
      const s = v.trim().replace(/_/g, '');
      if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
      if (/^[+-]?nan$/i.test(s)) return NaN;
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) throw err('ValueError', `could not convert string to float: ${reprStr(v)}`);
      return Number(s);
    }
    throw err('TypeError', `float() argument must be a string or a real number, not '${typeName(v)}'`);
  };
  const intT = type('int', (v) => (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'boolean', (a) => (a.length ? toInt(a[0]) : 0));
  type('float', (v) => typeof v === 'number', (a) => (a.length ? toFloat(a[0]) : 0));
  type('bool', (v) => typeof v === 'boolean', (a) => truthy(a[0]));
  type('str', (v) => typeof v === 'string', async (a) => (a.length ? I().pyStr(a[0]) : ''));
  type('list', isList, async (a) => (a.length ? I().iterate(a[0]) : []));
  type('tuple', isTuple, async (a) => tuple(a.length ? await I().iterate(a[0]) : []));
  type('set', (v) => v instanceof PySet, async (a) => new PySet(a.length ? await I().iterate(a[0]) : []));
  type('frozenset', (v) => v instanceof PySet, async (a) => new PySet(a.length ? await I().iterate(a[0]) : []));
  type('dict', (v) => v instanceof PyDict, async (a, k) => {
    const d = new PyDict();
    if (a[0] instanceof PyDict) for (const [x, y] of a[0].items()) d.set(x, y);
    else if (a.length) for (const pair of await I().iterate(a[0])) {
      const p = await I().iterate(pair);
      if (p.length !== 2) throw err('ValueError', `dictionary update sequence element has length ${p.length}; 2 is required`);
      d.set(p[0], p[1]);
    }
    for (const [x, y] of k) d.set(x, y);
    return d;
  });
  type('range', (v) => v instanceof PyRange, (a) => {
    const n = a.map((x) => toInt(x));
    if (n.length === 1) return new PyRange(0, n[0], 1);
    if (n[2] === 0) throw err('ValueError', 'range() arg 3 must not be zero');
    return new PyRange(n[0], n[1], n[2] ?? 1);
  });
  const typeT = type('type', (v) => v instanceof PyClass, (a) => classOf(a[0]));
  E.object.check = () => true;
  E.object.native = () => new PyInstance(E.object);
  b.set('object', E.object);
  const classOf = (v: unknown): PyClass => {
    if (v instanceof PyInstance) return v.cls;
    if (v instanceof PyClass) return typeT;
    const n = typeName(v);
    const c = b.get(n === 'NoneType' ? '__NoneType' : n);
    if (c instanceof PyClass) return c;
    const synthetic = new PyClass(n, [E.object]);
    synthetic.check = (x) => typeName(x) === n;
    return synthetic;
  };
  const noneT = new PyClass('NoneType', [E.object]);
  noneT.check = (v) => v === null || v === undefined;
  b.set('__NoneType', noneT);
  void intT;

  for (const [k, v] of Object.entries(E)) if (!['object', 'PlaywrightError', 'PlaywrightTimeoutError', 'Skipped', 'Failed', 'XFailed', 'JSONDecodeError'].includes(k)) b.set(k, v);

  const isinstance = (v: unknown, c: unknown): boolean => {
    if (isTuple(c)) return c.some((x) => isinstance(v, x));
    if (!(c instanceof PyClass)) throw err('TypeError', 'isinstance() arg 2 must be a type, a tuple of types, or a union');
    if (c.check) return c.check(v);
    return v instanceof PyInstance && v.cls.isSubclassOf(c);
  };

  // --- functions ---
  const def = (name: string, f: NativeFn) => b.set(name, fn(name, f));
  def('print', async (a, k) => {
    checkKw('print', k, ['sep', 'end', 'file', 'flush']);
    const parts: string[] = [];
    for (const x of a) parts.push(await I().pyStr(x));
    const sep = kw(k, 'sep', ' ');
    const end = kw(k, 'end', '\n');
    hooks.print(parts.join(sep === null ? ' ' : String(sep)) + (end === null ? '\n' : String(end)));
    return null;
  });
  def('len', (a) => {
    const v = a[0];
    if (typeof v === 'string') return [...v].length;
    if (Array.isArray(v)) return v.length;
    if (v instanceof PyDict || v instanceof PySet) return v.size;
    if (v instanceof PyRange) return v.values().length;
    if (isHost(v) && v.pyLen) return v.pyLen();
    if (v instanceof PyInstance && v.cls.has('__len__')) return I().callMethod(v, '__len__', []);
    throw err('TypeError', `object of type '${typeName(v)}' has no len()`);
  });
  def('repr', async (a) => I().pyRepr(a[0]));
  def('abs', (a) => Math.abs(Number(a[0])));
  def('round', (a) => {
    const x = Number(a[0]);
    if (a[1] === undefined || a[1] === null) {
      const r = Math.round(x);
      return Math.abs(x % 1) === 0.5 ? (r % 2 === 0 ? r : r - 1) : r;
    }
    return Number(x.toFixed(Number(a[1])));
  });
  const minmax = (name: string, pick: (c: number) => boolean): NativeFn => async (a, k) => {
    let items = a.length === 1 ? await I().iterate(a[0]) : a;
    const key = kw(k, 'key');
    if (!items.length) {
      if (k.has('default')) return k.get('default');
      throw err('ValueError', `${name}() iterable argument is empty`);
    }
    items = [...items];
    let best = items[0];
    let bestK = key ? await I().call(key, [best], new Map()) : best;
    for (const x of items.slice(1)) {
      const xk = key ? await I().call(key, [x], new Map()) : x;
      if (pick(I().cmp(xk, bestK))) { best = x; bestK = xk; }
    }
    return best;
  };
  def('min', minmax('min', (c) => c < 0));
  def('max', minmax('max', (c) => c > 0));
  def('sum', async (a) => {
    let total: unknown = a[1] ?? 0;
    for (const x of await I().iterate(a[0])) total = await I().binop('+', total, x);
    return total;
  });
  def('sorted', async (a, k) => sortValues(I(), await I().iterate(a[0]), kw(k, 'key'), truthy(kw(k, 'reverse', false))));
  def('reversed', async (a) => [...(await I().iterate(a[0]))].reverse());
  def('enumerate', async (a, k) => {
    const start = Number(a[1] ?? kw(k, 'start', 0));
    return (await I().iterate(a[0])).map((x, i) => tuple([i + start, x]));
  });
  def('zip', async (a) => {
    const lists = await Promise.all(a.map((x) => I().iterate(x)));
    const n = lists.length ? Math.min(...lists.map((l) => l.length)) : 0;
    return Array.from({ length: n }, (_, i) => tuple(lists.map((l) => l[i])));
  });
  def('map', async (a) => {
    const lists = await Promise.all(a.slice(1).map((x) => I().iterate(x)));
    const n = Math.min(...lists.map((l) => l.length));
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(await I().call(a[0], lists.map((l) => l[i]), new Map()));
    return out;
  });
  def('filter', async (a) => {
    const out: unknown[] = [];
    for (const x of await I().iterate(a[1])) if (a[0] === null ? truthy(x) : truthy(await I().call(a[0], [x], new Map()))) out.push(x);
    return out;
  });
  def('any', async (a) => (await I().iterate(a[0])).some(truthy));
  def('all', async (a) => (await I().iterate(a[0])).every(truthy));
  def('isinstance', (a) => isinstance(a[0], a[1]));
  def('issubclass', (a) => a[0] instanceof PyClass && (isTuple(a[1]) ? a[1].some((c) => c instanceof PyClass && (a[0] as PyClass).isSubclassOf(c)) : a[1] instanceof PyClass && a[0].isSubclassOf(a[1])));
  def('hasattr', async (a) => (await I().getAttrOpt(a[0], String(a[1]))) !== MISSING_REF.v);
  def('getattr', async (a) => {
    const v = await I().getAttrOpt(a[0], String(a[1]));
    if (v !== MISSING_REF.v) return v;
    if (a.length > 2) return a[2];
    throw I().attrError(a[0], String(a[1]));
  });
  def('setattr', async (a) => { await I().setAttr(a[0], String(a[1]), a[2]); return null; });
  def('callable', (a) => a[0] instanceof PyFunction || a[0] instanceof PyBuiltin || a[0] instanceof PyBoundMethod || a[0] instanceof PyClass);
  def('iter', async (a) => new PyGenerator(await I().iterate(a[0])));
  def('next', (a) => {
    const g = a[0];
    if (g instanceof PyGenerator) {
      if (g.pos < g.items.length) return g.items[g.pos++];
      if (a.length > 1) return a[1];
      throw err('StopIteration', '');
    }
    throw err('TypeError', `'${typeName(g)}' object is not an iterator`);
  });
  def('chr', (a) => String.fromCodePoint(Number(a[0])));
  def('ord', (a) => String(a[0]).codePointAt(0) ?? 0);
  def('divmod', (a) => tuple([Math.floor(Number(a[0]) / Number(a[1])), ((Number(a[0]) % Number(a[1])) + Number(a[1])) % Number(a[1])]));
  def('pow', (a) => Number(a[0]) ** Number(a[1]));
  def('hash', (a) => { void a; return 0; });
  def('id', () => Math.floor(Math.random() * 1e9));
  def('format', (a) => formatSpec(a[0], String(a[1] ?? ''), I()));
  def('vars', (a) => (a[0] instanceof PyInstance ? PyDict.from(a[0].dict) : new PyDict()));
  def('input', () => { throw err('OSError', 'reading from stdin is not possible while tests run'); });
  def('exit', () => { throw err('SystemExit', ''); });
  def('open', (a, k) => {
    const path = String(a[0]).replace(/^\.\//, '');
    const mode = String(a[1] ?? kw(k, 'mode', 'r'));
    if (/[wax+]/.test(mode)) throw Object.assign(err('OSError', `[Errno 30] Read-only file system: ${reprStr(path)}`), { emuNote: true });
    const text = hooks.files[path];
    if (text === undefined) throw err('FileNotFoundError', `[Errno 2] No such file or directory: ${reprStr(path)}`);
    return new FileHost(path, text);
  });
  def('super', (a) => {
    const frame = I().top;
    const cls = (a[0] as PyClass | undefined) ?? frame?.cls;
    const self = a[1] ?? frame?.self;
    if (!cls || self === undefined) throw err('RuntimeError', 'super(): no arguments');
    return new SuperHost(I(), cls, self);
  });
  b.set('staticmethod', new PyClass('staticmethod'));
  (b.get('staticmethod') as PyClass).native = (a) => new PyStaticMethod(a[0]);
  b.set('classmethod', new PyClass('classmethod'));
  (b.get('classmethod') as PyClass).native = (a) => new PyClassMethod(a[0]);
  b.set('property', new PyClass('property'));
  (b.get('property') as PyClass).native = (a) => new PyProperty(a[0], a[1] ?? null);
  b.set('NotImplemented', null);
  b.set('Ellipsis', null);
  b.set('__name__', '__main__');
  return b;
}

/** Filled after Interp creation (MISSING symbol lives in interp.ts). */
export const MISSING_REF: { v: symbol } = { v: Symbol('unset') };

class SuperHost implements PyHost {
  readonly pyType = 'super';
  constructor(private ip: Interp, private cls: PyClass, private self: unknown) {}
  pyGetAttr(name: string): unknown {
    const selfCls = this.self instanceof PyInstance ? this.self.cls : this.self instanceof PyClass ? this.self : null;
    if (!selfCls) return undefined;
    const mro = selfCls.mro;
    for (const c of mro.slice(mro.indexOf(this.cls) + 1)) {
      if (c.dict.has(name)) {
        const v = c.dict.get(name);
        if (this.self instanceof PyInstance) return this.ip.bindFromClass(v, this.self, selfCls);
        return v;
      }
    }
    if (name === '__init__') return fn('__init__', () => null);
    return undefined;
  }
  pyRepr() { return `<super: <class '${this.cls.name}'>>`; }
}

export class FileHost implements PyHost {
  readonly pyType = 'TextIOWrapper';
  constructor(public path: string, public text: string) {}
  pyGetAttr(name: string): unknown {
    if (name === 'read') return fn('read', () => this.text, 'TextIOWrapper');
    if (name === 'readlines') return fn('readlines', () => this.text.split(/(?<=\n)/), 'TextIOWrapper');
    if (name === 'close') return fn('close', () => null, 'TextIOWrapper');
    if (name === 'name') return this.path;
    return undefined;
  }
  pyIter() { return this.text.split(/(?<=\n)/); }
  pyEnter() { return this; }
  pyExit() { return false; }
  pyRepr() { return `<_io.TextIOWrapper name=${reprStr(this.path)} mode='r' encoding='UTF-8'>`; }
}

// ---------- standard library ----------

export function makeStdlib(ip: () => Interp, E: Record<string, PyClass>, hooks: { sleep: (ms: number) => Promise<void>; print: (s: string) => void; onHardWait?: () => void }): Record<string, () => PyModule> {
  const I = () => ip();
  const err = (name: string, msg: string) => I().err(name, msg);
  const mod = (name: string, entries: Record<string, unknown>) => {
    const m = new PyModule(name);
    for (const [k, v] of Object.entries(entries)) m.dict.set(k, v);
    return m;
  };
  const f = (name: string, impl: NativeFn) => fn(name, impl);

  // --- re ---
  const FLAGS = { IGNORECASE: 2, I: 2, MULTILINE: 8, M: 8, DOTALL: 16, S: 16, VERBOSE: 64, X: 64 };
  const compile = (pattern: unknown, flags: unknown = 0): PyPattern => {
    if (pattern instanceof PyPattern) return pattern;
    if (typeof pattern !== 'string') throw err('TypeError', `first argument must be string or compiled pattern`);
    let src = pattern;
    let fl = Number(flags || 0);
    const inline = /^\(\?([aiLmsux]+)\)/.exec(src);
    if (inline) {
      src = src.slice(inline[0].length);
      if (inline[1].includes('i')) fl |= 2;
      if (inline[1].includes('m')) fl |= 8;
      if (inline[1].includes('s')) fl |= 16;
    }
    src = src.replace(/\(\?P<(\w+)>/g, '(?<$1>').replace(/\(\?P=(\w+)\)/g, '\\k<$1>').replace(/\\A/g, '^').replace(/\\Z/g, '$');
    let js = '';
    if (fl & 2) js += 'i';
    if (fl & 8) js += 'm';
    if (fl & 16) js += 's';
    try {
      return new PyPattern(pattern, fl, new RegExp(src, js));
    } catch (e) {
      const x = err('PatternError', `${(e as Error).message.replace(/^Invalid regular expression: /, '')}`);
      x.exc.cls = E.ValueError;
      throw x;
    }
  };
  const search = (p: PyPattern, s: unknown, mode: 'search' | 'match' | 'full'): PyMatch | null => {
    if (typeof s !== 'string') throw err('TypeError', `expected string or bytes-like object, got '${typeName(s)}'`);
    const re = mode === 'search' ? new RegExp(p.re.source, p.re.flags) : new RegExp(mode === 'match' ? `^(?:${p.re.source})` : `^(?:${p.re.source})$`, p.re.flags);
    const m = re.exec(s);
    return m ? new PyMatch(m, s) : null;
  };
  I().typeAttrs['re.Pattern'] = { pattern: (p: PyPattern) => p.pattern, flags: (p: PyPattern) => p.flags };
  I().extraMethods['re.Pattern'] = {
    search: (p: PyPattern, a) => search(p, a[0], 'search'),
    match: (p: PyPattern, a) => search(p, a[0], 'match'),
    fullmatch: (p: PyPattern, a) => search(p, a[0], 'full'),
    findall: (p: PyPattern, a) => findall(p, String(a[0])),
    sub: (p: PyPattern, a) => String(a[1]).replace(new RegExp(p.re.source, p.re.flags + 'g'), pyRepl(String(a[0]))),
    split: (p: PyPattern, a) => String(a[0]).split(new RegExp(p.re.source, p.re.flags)),
  };
  I().extraMethods['re.Match'] = {
    group: (m: PyMatch, a) => {
      if (!a.length) return m.m[0];
      const g = a[0];
      const v = typeof g === 'number' ? m.m[g] : m.m.groups?.[String(g)];
      if (v === undefined && (typeof g !== 'number' || g > m.m.length - 1)) throw err('IndexError', 'no such group');
      return v ?? null;
    },
    groups: (m: PyMatch) => tuple(m.m.slice(1).map((x) => x ?? null)),
    start: (m: PyMatch) => m.m.index,
    end: (m: PyMatch) => m.m.index + m.m[0].length,
  };
  const findall = (p: PyPattern, s: string) => {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g');
    const out: unknown[] = [];
    for (const m of s.matchAll(re)) out.push(m.length === 1 ? m[0] : m.length === 2 ? m[1] ?? '' : tuple(m.slice(1).map((x) => x ?? '')));
    return out;
  };
  const pyRepl = (r: string) => r.replace(/\\(\d)/g, '$$$1').replace(/\\g<(\w+)>/g, '$$<$1>');
  const re = () => mod('re', {
    compile: f('compile', (a, k) => compile(a[0], a[1] ?? k.get('flags'))),
    search: f('search', (a, k) => search(compile(a[0], a[2] ?? k.get('flags')), a[1], 'search')),
    match: f('match', (a, k) => search(compile(a[0], a[2] ?? k.get('flags')), a[1], 'match')),
    fullmatch: f('fullmatch', (a, k) => search(compile(a[0], a[2] ?? k.get('flags')), a[1], 'full')),
    findall: f('findall', (a, k) => findall(compile(a[0], a[2] ?? k.get('flags')), String(a[1]))),
    sub: f('sub', (a, k) => { const p = compile(a[0], k.get('flags')); return String(a[2]).replace(new RegExp(p.re.source, p.re.flags + 'g'), pyRepl(String(a[1]))); }),
    split: f('split', (a) => String(a[1]).split(compile(a[0]).re)),
    escape: f('escape', (a) => String(a[0]).replace(/[.*+?^${}()|[\]\\\-/#&~ ]/g, '\\$&')),
    Pattern: Object.assign(new PyClass('Pattern', [], 're'), { check: (v: unknown) => v instanceof PyPattern }),
    ...FLAGS,
  });

  // --- json ---
  const dumps = async (v: unknown, indent: unknown, depth = 0): Promise<string> => {
    const ind = typeof indent === 'number' ? indent : null;
    const nl = (d: number) => (ind === null ? '' : '\n' + ' '.repeat(ind * d));
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    if (typeof v === 'string') return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      const parts = await Promise.all(v.map((x) => dumps(x, indent, depth + 1)));
      return ind === null ? `[${parts.join(', ')}]` : `[${nl(depth + 1)}${parts.join(',' + nl(depth + 1))}${nl(depth)}]`;
    }
    if (v instanceof PyDict) {
      if (!v.size) return '{}';
      const parts: string[] = [];
      for (const [k, x] of v.items()) {
        const key = typeof k === 'string' ? k : typeof k === 'number' ? String(k) : k === null ? 'null' : typeof k === 'boolean' ? String(k) : null;
        if (key === null) throw err('TypeError', `keys must be str, int, float, bool or None, not ${typeName(k)}`);
        parts.push(`${JSON.stringify(key)}: ${await dumps(x, indent, depth + 1)}`);
      }
      return ind === null ? `{${parts.join(', ')}}` : `{${nl(depth + 1)}${parts.join(',' + nl(depth + 1))}${nl(depth)}}`;
    }
    throw err('TypeError', `Object of type ${typeName(v)} is not JSON serializable`);
  };
  const loads = (s: unknown) => {
    if (typeof s !== 'string') throw err('TypeError', `the JSON object must be str, bytes or bytearray, not ${typeName(s)}`);
    try {
      return fromJs(JSON.parse(s));
    } catch (e) {
      const x = err('JSONDecodeError', `Expecting value: line 1 column 1 (char 0)`);
      void e;
      return Promise.reject(x);
    }
  };
  const json = () => mod('json', {
    dumps: f('dumps', (a, k) => dumps(a[0], k.get('indent') ?? null)),
    loads: f('loads', (a) => loads(a[0])),
    load: f('load', async (a) => loads(await I().callMethod(a[0], 'read', []))),
    JSONDecodeError: E.JSONDecodeError,
  });

  // --- time ---
  const time = () => mod('time', {
    sleep: f('sleep', async (a) => { hooks.onHardWait?.(); await hooks.sleep(Number(a[0]) * 1000); return null; }),
    time: f('time', () => Date.now() / 1000),
    perf_counter: f('perf_counter', () => performance.now() / 1000),
    monotonic: f('monotonic', () => performance.now() / 1000),
  });

  // --- os ---
  const environ = new PyDict();
  const os = () => {
    const path = mod('os.path', {
      join: f('join', (a) => a.map(String).join('/').replace(/\/+/g, '/')),
      exists: f('exists', () => false),
      dirname: f('dirname', (a) => String(a[0]).split('/').slice(0, -1).join('/')),
      basename: f('basename', (a) => String(a[0]).split('/').pop() ?? ''),
      abspath: f('abspath', (a) => String(a[0])),
    });
    return mod('os', {
      environ,
      getenv: f('getenv', (a) => (environ.has(a[0]) ? environ.get(a[0]) : (a[1] ?? null))),
      path,
      sep: '/',
    });
  };

  // --- random / uuid ---
  const random = () => mod('random', {
    randint: f('randint', (a) => Math.floor(Math.random() * (Number(a[1]) - Number(a[0]) + 1)) + Number(a[0])),
    random: f('random', () => Math.random()),
    choice: f('choice', async (a) => { const l = await I().iterate(a[0]); if (!l.length) throw err('IndexError', 'Cannot choose from an empty sequence'); return l[Math.floor(Math.random() * l.length)]; }),
    uniform: f('uniform', (a) => Number(a[0]) + Math.random() * (Number(a[1]) - Number(a[0]))),
    shuffle: f('shuffle', (a) => { const l = a[0] as unknown[]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return null; }),
    seed: f('seed', () => null),
  });
  const uuid = () => mod('uuid', {
    uuid4: f('uuid4', () => new UuidHost()),
  });

  // --- math ---
  const math = () => mod('math', {
    floor: f('floor', (a) => Math.floor(Number(a[0]))),
    ceil: f('ceil', (a) => Math.ceil(Number(a[0]))),
    sqrt: f('sqrt', (a) => Math.sqrt(Number(a[0]))),
    isclose: f('isclose', (a, k) => {
      const x = Number(a[0]); const y = Number(a[1]);
      const rel = Number(k.get('rel_tol') ?? 1e-9); const abs = Number(k.get('abs_tol') ?? 0);
      return Math.abs(x - y) <= Math.max(rel * Math.max(Math.abs(x), Math.abs(y)), abs);
    }),
    inf: Infinity,
    pi: Math.PI,
  });

  // --- typing / __future__ / dataclasses ---
  const placeholder = (name: string, module: string) => { const c = new PyClass(name, [], module); c.check = () => true; return c; };
  const typing = () => {
    const m = new PyModule('typing');
    for (const n of ['Any', 'Callable', 'Dict', 'Generator', 'Iterable', 'Iterator', 'List', 'Literal', 'Optional', 'Sequence', 'Set', 'Tuple', 'Type', 'TypedDict', 'Union', 'Final', 'ClassVar', 'Mapping', 'NamedTuple', 'Protocol', 'Self']) m.dict.set(n, placeholder(n, 'typing'));
    m.dict.set('TYPE_CHECKING', false);
    return m;
  };
  const collectionsAbc = () => {
    const m = new PyModule('collections.abc');
    for (const n of ['Generator', 'Iterator', 'Iterable', 'Callable', 'Mapping', 'Sequence']) m.dict.set(n, placeholder(n, 'collections.abc'));
    return m;
  };
  const future = () => mod('__future__', { annotations: true });
  const MISSING_FIELD = new PyInstance(E.object);
  const dataclasses = () => {
    const field = f('field', (_a, k) => new FieldSpec(k.get('default') ?? MISSING_FIELD, k.get('default_factory') ?? null));
    const make = (cls: PyClass, opts: Kw): PyClass => {
      const fields: NonNullable<PyClass['fields']> = [];
      for (const name of cls.annotations) {
        const d = cls.dict.get(name);
        if (d instanceof FieldSpec) {
          fields.push({ name, hasDefault: d.def !== MISSING_FIELD || d.factory !== null, default: d });
          cls.dict.delete(name);
        } else fields.push({ name, hasDefault: cls.dict.has(name), default: d });
      }
      cls.fields = fields;
      const frozen = truthy(opts.get('frozen') ?? false);
      cls.dict.set('__init__', fn('__init__', async (a, k) => {
        const self = a[0] as PyInstance;
        const args = a.slice(1);
        if (args.length > fields.length) throw err('TypeError', `${cls.name}.__init__() takes ${fields.length + 1} positional arguments but ${args.length + 1} were given`);
        const missing: string[] = [];
        for (let i = 0; i < fields.length; i++) {
          const fd = fields[i];
          let v: unknown;
          if (i < args.length) v = args[i];
          else if (k.has(fd.name)) v = k.get(fd.name);
          else if (fd.hasDefault) {
            const d = fd.default;
            v = d instanceof FieldSpec ? (d.factory ? await I().call(d.factory, [], new Map()) : d.def) : d;
          } else { missing.push(`'${fd.name}'`); continue; }
          self.dict.set(fd.name, v);
        }
        for (const key of k.keys()) if (!fields.some((x) => x.name === key)) throw err('TypeError', `${cls.name}.__init__() got an unexpected keyword argument '${key}'`);
        if (missing.length) throw err('TypeError', `${cls.name}.__init__() missing ${missing.length} required positional argument${missing.length > 1 ? 's' : ''}: ${missing.join(' and ')}`);
        if (frozen) self.dict.set('__frozen__', true);
        return null;
      }));
      return cls;
    };
    const dataclass = f('dataclass', (a, k) => {
      if (a[0] instanceof PyClass) return make(a[0], k);
      return f('dataclass', (b2) => make(b2[0] as PyClass, k));
    });
    return mod('dataclasses', { dataclass, field, asdict: f('asdict', (a) => { const i = a[0] as PyInstance; return PyDict.from((i.cls.fields ?? []).map((x) => [x.name, i.dict.get(x.name)])); }) });
  };

  // --- datetime (minimal) ---
  const datetimeMod = () => {
    const dateCls = new PyClass('date', [E.object], 'datetime');
    const dtCls = new PyClass('datetime', [dateCls], 'datetime');
    const tdCls = new PyClass('timedelta', [E.object], 'datetime');
    tdCls.native = (a, k) => new TimedeltaHost(Number(a[0] ?? k.get('days') ?? 0) * 86400000 + Number(k.get('hours') ?? 0) * 3600000 + Number(k.get('minutes') ?? 0) * 60000 + Number(k.get('seconds') ?? 0) * 1000);
    tdCls.check = (v) => v instanceof TimedeltaHost;
    dateCls.native = (a) => new DateHost(new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2])), false);
    dateCls.check = (v) => v instanceof DateHost;
    dtCls.native = (a) => new DateHost(new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]), Number(a[3] ?? 0), Number(a[4] ?? 0), Number(a[5] ?? 0)), true);
    dtCls.check = (v) => v instanceof DateHost && v.withTime;
    dateCls.dict.set('today', new PyStaticMethod(f('today', () => new DateHost(new Date(), false))));
    dtCls.dict.set('now', new PyStaticMethod(f('now', () => new DateHost(new Date(), true))));
    dtCls.dict.set('today', new PyStaticMethod(f('today', () => new DateHost(new Date(), true))));
    return mod('datetime', { date: dateCls, datetime: dtCls, timedelta: tdCls });
  };

  // --- logging (prints to the console output) ---
  const logging = () => {
    const logger = (name: string) => {
      const m = new PyModule(name);
      for (const lvl of ['debug', 'info', 'warning', 'error', 'critical', 'exception']) {
        m.dict.set(lvl, f(lvl, async (a) => { hooks.print(`${lvl.toUpperCase()}:${name}:${await I().pyStr(a[0])}\n`); return null; }));
      }
      return m;
    };
    const root = logger('root');
    return mod('logging', {
      getLogger: f('getLogger', (a) => logger(String(a[0] ?? 'root'))),
      basicConfig: f('basicConfig', () => null),
      info: root.dict.get('info'), warning: root.dict.get('warning'), error: root.dict.get('error'), debug: root.dict.get('debug'),
      DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40,
    });
  };

  return {
    re, json, time, os, 'os.path': () => os().dict.get('path') as PyModule, random, uuid, math, typing, 'collections.abc': collectionsAbc,
    __future__: future, dataclasses, datetime: datetimeMod, logging,
  };
}

class FieldSpec { constructor(public def: unknown, public factory: unknown) {} }

class UuidHost implements PyHost {
  readonly pyType = 'UUID';
  hex: string;
  constructor() {
    const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
    h[12] = '4';
    this.hex = h.join('');
  }
  get s() { return `${this.hex.slice(0, 8)}-${this.hex.slice(8, 12)}-${this.hex.slice(12, 16)}-${this.hex.slice(16, 20)}-${this.hex.slice(20)}`; }
  pyGetAttr(name: string) { return name === 'hex' ? this.hex : undefined; }
  pyRepr() { return `UUID('${this.s}')`; }
  pyStr() { return this.s; }
}

class TimedeltaHost implements PyHost {
  readonly pyType = 'timedelta';
  constructor(public ms: number) {}
  pyGetAttr(name: string) { return name === 'days' ? Math.floor(this.ms / 86400000) : name === 'total_seconds' ? fn('total_seconds', () => this.ms / 1000) : undefined; }
  pyRepr() { return `datetime.timedelta(days=${Math.floor(this.ms / 86400000)})`; }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
class DateHost implements PyHost {
  readonly pyType: string;
  constructor(public d: Date, public withTime: boolean) { this.pyType = withTime ? 'datetime' : 'date'; }
  iso(): string {
    const date = `${this.d.getFullYear()}-${pad(this.d.getMonth() + 1)}-${pad(this.d.getDate())}`;
    return this.withTime ? `${date}T${pad(this.d.getHours())}:${pad(this.d.getMinutes())}:${pad(this.d.getSeconds())}` : date;
  }
  pyGetAttr(name: string): unknown {
    switch (name) {
      case 'year': return this.d.getFullYear();
      case 'month': return this.d.getMonth() + 1;
      case 'day': return this.d.getDate();
      case 'isoformat': return fn('isoformat', () => this.iso());
      case 'date': return fn('date', () => new DateHost(new Date(this.d.getFullYear(), this.d.getMonth(), this.d.getDate()), false));
      case 'weekday': return fn('weekday', () => (this.d.getDay() + 6) % 7);
      case 'strftime': return fn('strftime', (a) => String(a[0]).replace(/%([YmdHMSyBbAa%])/g, (_, c: string) => {
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        switch (c) {
          case 'Y': return String(this.d.getFullYear());
          case 'y': return pad(this.d.getFullYear() % 100);
          case 'm': return pad(this.d.getMonth() + 1);
          case 'd': return pad(this.d.getDate());
          case 'H': return pad(this.d.getHours());
          case 'M': return pad(this.d.getMinutes());
          case 'S': return pad(this.d.getSeconds());
          case 'B': return months[this.d.getMonth()];
          case 'b': return months[this.d.getMonth()].slice(0, 3);
          case 'A': return days[this.d.getDay()];
          case 'a': return days[this.d.getDay()].slice(0, 3);
          default: return '%';
        }
      }));
    }
    return undefined;
  }
  pyBinop(op: string, other: unknown): unknown {
    if (other instanceof TimedeltaHost && (op === '+' || op === '-')) return new DateHost(new Date(this.d.getTime() + (op === '+' ? other.ms : -other.ms)), this.withTime);
    if (other instanceof DateHost && op === '-') return new TimedeltaHost(this.d.getTime() - other.d.getTime());
    return undefined;
  }
  pyEq(other: unknown) { return other instanceof DateHost && other.iso() === this.iso(); }
  pyRepr() { return this.withTime ? `datetime.datetime(${this.d.getFullYear()}, ${this.d.getMonth() + 1}, ${this.d.getDate()}, ${this.d.getHours()}, ${this.d.getMinutes()})` : `datetime.date(${this.d.getFullYear()}, ${this.d.getMonth() + 1}, ${this.d.getDate()})`; }
  pyStr() { return this.withTime ? this.iso().replace('T', ' ') : this.iso(); }
}

export { suggest, isUncatchable, PyException, repr, str, pyEq };
