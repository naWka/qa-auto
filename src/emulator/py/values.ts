// Python values on top of JS values.
//   None → null, bool → boolean, int/float → number, str → string, list → Array,
//   tuple → frozen Array tagged with TUPLE, dict → PyDict, set → PySet.
import type { FunctionDefNode } from './interp-types';

export const TUPLE = Symbol('tuple');

export function tuple(items: unknown[]): unknown[] {
  const a = [...items] as unknown[] & { [TUPLE]?: true };
  Object.defineProperty(a, TUPLE, { value: true });
  return Object.freeze(a);
}
export function isTuple(v: unknown): v is unknown[] {
  return Array.isArray(v) && (v as { [TUPLE]?: true })[TUPLE] === true;
}
export function isList(v: unknown): v is unknown[] {
  return Array.isArray(v) && !(v as { [TUPLE]?: true })[TUPLE];
}

// ---------- classes, instances, functions ----------

export class PyClass {
  name: string;
  bases: PyClass[];
  dict = new Map<string, unknown>();
  mro: PyClass[];
  module: string;
  /** builtin types: how calling the class builds a value, and what counts as an instance */
  native?: (args: unknown[], kwargs: Map<string, unknown>) => unknown | Promise<unknown>;
  check?: (v: unknown) => boolean;
  /** for @dataclass: field names with defaults */
  fields?: Array<{ name: string; hasDefault: boolean; default?: unknown }>;
  annotations: string[] = [];

  constructor(name: string, bases: PyClass[] = [], module = 'builtins') {
    this.name = name;
    this.bases = bases;
    this.module = module;
    this.mro = [this];
    for (const b of bases) for (const c of b.mro) if (!this.mro.includes(c)) this.mro.push(c);
  }
  lookup(name: string): unknown {
    for (const c of this.mro) if (c.dict.has(name)) return c.dict.get(name);
    return undefined;
  }
  has(name: string): boolean {
    return this.mro.some((c) => c.dict.has(name));
  }
  isSubclassOf(other: PyClass): boolean {
    return this.mro.includes(other);
  }
}

export class PyInstance {
  cls: PyClass;
  dict = new Map<string, unknown>();
  constructor(cls: PyClass) { this.cls = cls; }
}

/** A user-defined function (def / lambda). */
export class PyFunction {
  name: string;
  qualname: string;
  node: FunctionDefNode;
  closure: unknown;
  defaults: Map<string, unknown>;
  module: string;
  file: string;
  /** set by decorators: pytest marks, fixture definitions */
  attrs = new Map<string, unknown>();
  constructor(name: string, qualname: string, node: FunctionDefNode, closure: unknown, defaults: Map<string, unknown>, module: string, file: string) {
    this.name = name;
    this.qualname = qualname;
    this.node = node;
    this.closure = closure;
    this.defaults = defaults;
    this.module = module;
    this.file = file;
  }
}

export type NativeFn = (args: unknown[], kwargs: Map<string, unknown>) => unknown | Promise<unknown>;

/** A function implemented in JS: builtins, module functions, bound Playwright methods. */
export class PyBuiltin {
  name: string;
  fn: NativeFn;
  /** description used in repr and error messages */
  owner?: string;
  attrs = new Map<string, unknown>();
  constructor(name: string, fn: NativeFn, owner?: string) {
    this.name = name;
    this.fn = fn;
    this.owner = owner;
  }
}

export class PyBoundMethod {
  self: unknown;
  func: PyFunction | PyBuiltin;
  constructor(self: unknown, func: PyFunction | PyBuiltin) {
    this.self = self;
    this.func = func;
  }
}

export class PyStaticMethod { constructor(public func: unknown) {} }
export class PyClassMethod { constructor(public func: unknown) {} }
export class PyProperty { constructor(public fget: unknown, public fset: unknown = null) {} }

export class PyModule {
  name: string;
  dict = new Map<string, unknown>();
  file?: string;
  constructor(name: string, file?: string) { this.name = name; this.file = file; }
}

/** Objects implemented in JS (Playwright Page, Locator, …). */
export interface PyHost {
  readonly pyType: string;
  pyGetAttr(name: string): unknown;
  pyRepr?(): string;
  pyIter?(): unknown[];
  pyEnter?(): unknown | Promise<unknown>;
  pyExit?(exc: PyException | null): boolean | Promise<boolean>;
  pyEq?(other: unknown): boolean;
  pyLen?(): number;
  pyBool?(): boolean;
  pyBinop?(op: string, other: unknown): unknown;
  pyDir?(): string[];
  pyCall?(args: unknown[], kwargs: Map<string, unknown>): unknown;
  pyStr?(): string;
}
export function isHost(v: unknown): v is PyHost {
  return !!v && typeof v === 'object' && typeof (v as PyHost).pyGetAttr === 'function' && typeof (v as PyHost).pyType === 'string';
}

// ---------- dict / set ----------

export function hashKey(v: unknown): string {
  if (v === null) return 'N';
  if (typeof v === 'string') return 's' + v;
  if (typeof v === 'number') return 'n' + (Object.is(v, -0) ? 0 : v);
  if (typeof v === 'boolean') return 'n' + (v ? 1 : 0);
  if (isTuple(v)) return 't(' + v.map(hashKey).join(',') + ')';
  if (v instanceof PyClass) return 'c' + classId(v);
  if (v instanceof PyInstance || v instanceof PyFunction || v instanceof PyBuiltin || v instanceof PyModule || isHost(v)) return 'o' + objId(v);
  throw new TypeError(`unhashable type: '${typeName(v)}'`);
}
const ids = new WeakMap<object, number>();
let nextId = 1;
function objId(o: object): number {
  let id = ids.get(o);
  if (!id) { id = nextId++; ids.set(o, id); }
  return id;
}
function classId(c: PyClass) { return objId(c); }

export class PyDict {
  map = new Map<string, [unknown, unknown]>();
  static from(entries: Iterable<[unknown, unknown]>): PyDict {
    const d = new PyDict();
    for (const [k, v] of entries) d.set(k, v);
    return d;
  }
  get(k: unknown): unknown { return this.map.get(hashKey(k))?.[1]; }
  has(k: unknown): boolean { return this.map.has(hashKey(k)); }
  set(k: unknown, v: unknown) {
    const h = hashKey(k);
    const cur = this.map.get(h);
    if (cur) cur[1] = v;
    else this.map.set(h, [k, v]);
  }
  delete(k: unknown): boolean { return this.map.delete(hashKey(k)); }
  keys(): unknown[] { return [...this.map.values()].map((e) => e[0]); }
  values(): unknown[] { return [...this.map.values()].map((e) => e[1]); }
  items(): Array<[unknown, unknown]> { return [...this.map.values()].map((e) => [e[0], e[1]]); }
  get size() { return this.map.size; }
}

export class PySet {
  map = new Map<string, unknown>();
  constructor(items: Iterable<unknown> = []) { for (const x of items) this.add(x); }
  add(v: unknown) { this.map.set(hashKey(v), v); }
  has(v: unknown) { return this.map.has(hashKey(v)); }
  delete(v: unknown) { return this.map.delete(hashKey(v)); }
  values(): unknown[] { return [...this.map.values()]; }
  get size() { return this.map.size; }
}

export class PyRange {
  constructor(public start: number, public stop: number, public step: number) {}
  values(): number[] {
    const out: number[] = [];
    if (this.step > 0) for (let i = this.start; i < this.stop; i += this.step) out.push(i);
    else for (let i = this.start; i > this.stop; i += this.step) out.push(i);
    if (out.length > 1_000_000) throw new RangeError('range too large for the emulator');
    return out;
  }
}

/** re.compile(...) result */
export class PyPattern {
  pattern: string;
  flags: number;
  re: RegExp;
  constructor(pattern: string, flags: number, re: RegExp) {
    this.pattern = pattern;
    this.flags = flags;
    this.re = re;
  }
}

export class PyMatch {
  constructor(public m: RegExpExecArray, public input: string) {}
}

// ---------- exceptions ----------

export interface TraceEntry { file: string; line: number; name: string }

/** A raised Python exception travelling through JS. */
export class PyException extends Error {
  exc: PyInstance;
  tb: TraceEntry[] = [];
  /** original emulator error (Playwright errors, expect failures) */
  emu?: { code: string; message: string; data: Record<string, string | number>; emulatorNote?: boolean };
  /** extra lines for assertion messages (pytest's "where" explanations) */
  constructor(exc: PyInstance) {
    super(exceptionMessage(exc));
    this.exc = exc;
    this.name = exc.cls.name;
  }
  get cls(): PyClass { return this.exc.cls; }
}

export function exceptionArgs(e: PyInstance): unknown[] {
  const a = e.dict.get('args');
  return Array.isArray(a) ? a : [];
}

export function exceptionMessage(e: PyInstance): string {
  const custom = e.dict.get('__message__');
  if (typeof custom === 'string') return custom;
  const args = exceptionArgs(e);
  if (e.cls.name === 'KeyError' && args.length === 1) return repr(args[0]);
  if (args.length === 0) return '';
  if (args.length === 1) return str(args[0]);
  return repr(tuple(args));
}

// ---------- type names, repr, str ----------

export function typeName(v: unknown): string {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'str';
  if (isTuple(v)) return 'tuple';
  if (Array.isArray(v)) return 'list';
  if (v instanceof PyDict) return 'dict';
  if (v instanceof PySet) return 'set';
  if (v instanceof PyRange) return 'range';
  if (v instanceof PyInstance) return v.cls.name;
  if (v instanceof PyClass) return 'type';
  if (v instanceof PyFunction) return 'function';
  if (v instanceof PyBuiltin) return 'builtin_function_or_method';
  if (v instanceof PyBoundMethod) return 'method';
  if (v instanceof PyModule) return 'module';
  if (v instanceof PyPattern) return 're.Pattern';
  if (v instanceof PyMatch) return 're.Match';
  if (isHost(v)) return v.pyType;
  return 'object';
}

export function fmtFloat(n: number): string {
  if (Number.isNaN(n)) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (Number.isInteger(n)) return String(n);
  const s = String(n);
  if (/e/.test(s)) return s.replace(/e([+-])(\d)$/, 'e$10$2');
  return s;
}

export function reprStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else out += ch;
  }
  return q + out + q;
}

export function repr(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return fmtFloat(v);
  if (typeof v === 'string') return reprStr(v);
  if (depth > 6) return '...';
  if (isTuple(v)) return v.length === 1 ? `(${repr(v[0], depth + 1)},)` : `(${v.map((x) => repr(x, depth + 1)).join(', ')})`;
  if (Array.isArray(v)) return `[${v.map((x) => repr(x, depth + 1)).join(', ')}]`;
  if (v instanceof PyDict) return `{${v.items().map(([k, x]) => `${repr(k, depth + 1)}: ${repr(x, depth + 1)}`).join(', ')}}`;
  if (v instanceof PySet) return v.size ? `{${v.values().map((x) => repr(x, depth + 1)).join(', ')}}` : 'set()';
  if (v instanceof PyRange) return v.step === 1 ? `range(${v.start}, ${v.stop})` : `range(${v.start}, ${v.stop}, ${v.step})`;
  if (v instanceof PyClass) return `<class '${v.module === 'builtins' ? '' : v.module + '.'}${v.name}'>`;
  if (v instanceof PyInstance) {
    if (v.cls.isSubclassOf(BASE_EXCEPTION_REF.cls!)) {
      const args = exceptionArgs(v);
      return `${v.cls.name}(${args.map((a) => repr(a, depth + 1)).join(', ')})`;
    }
    if (v.cls.fields) return `${v.cls.name}(${v.cls.fields.map((f) => `${f.name}=${repr(v.dict.get(f.name), depth + 1)}`).join(', ')})`;
    return `<${v.cls.module}.${v.cls.name} object>`;
  }
  if (v instanceof PyFunction) return `<function ${v.qualname}>`;
  if (v instanceof PyBuiltin) return v.owner ? `<bound method ${v.owner}.${v.name}>` : `<built-in function ${v.name}>`;
  if (v instanceof PyBoundMethod) {
    const n = v.func instanceof PyFunction ? v.func.qualname : `${typeName(v.self)}.${v.func.name}`;
    return `<bound method ${n} of ${repr(v.self, depth + 1)}>`;
  }
  if (v instanceof PyModule) return `<module '${v.name}'>`;
  if (v instanceof PyPattern) return `re.compile(${reprStr(v.pattern)}${v.flags & 2 ? ', re.IGNORECASE' : ''})`;
  if (v instanceof PyMatch) return `<re.Match object; span=(${v.m.index}, ${v.m.index + v.m[0].length}), match=${reprStr(v.m[0])}>`;
  if (isHost(v)) return v.pyRepr ? v.pyRepr() : `<${v.pyType} object>`;
  return String(v);
}

export function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (isHost(v) && v.pyStr) return v.pyStr();
  if (v instanceof PyInstance && BASE_EXCEPTION_REF.cls && v.cls.isSubclassOf(BASE_EXCEPTION_REF.cls)) return exceptionMessage(v);
  return repr(v);
}

/** Filled by builtins.ts once the exception classes exist (avoids an import cycle). */
export const BASE_EXCEPTION_REF: { cls: PyClass | null } = { cls: null };

// ---------- truthiness and equality ----------

export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof PyDict || v instanceof PySet) return v.size > 0;
  if (v instanceof PyRange) return v.values().length > 0;
  if (isHost(v) && v.pyBool) return v.pyBool();
  return true;
}

export function pyEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isHost(b) && b.pyEq && !isHost(a)) return b.pyEq(a);
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === 'number' || typeof a === 'boolean') {
    if (typeof b === 'number' || typeof b === 'boolean') return Number(a) === Number(b);
    return false;
  }
  if (typeof a === 'string') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || isTuple(a) !== isTuple(b) || a.length !== b.length) return false;
    return a.every((x, i) => pyEq(x, b[i]));
  }
  if (a instanceof PyDict) {
    if (!(b instanceof PyDict) || a.size !== b.size) return false;
    return a.items().every(([k, v]) => b.has(k) && pyEq(v, b.get(k)));
  }
  if (a instanceof PySet) {
    if (!(b instanceof PySet) || a.size !== b.size) return false;
    return a.values().every((x) => b.has(x));
  }
  if (a instanceof PyRange && b instanceof PyRange) return pyEq(a.values(), b.values());
  if (a instanceof PyInstance && a.cls.fields && b instanceof PyInstance && b.cls === a.cls) {
    return a.cls.fields.every((f) => pyEq(a.dict.get(f.name), b.dict.get(f.name)));
  }
  if (isHost(a) && a.pyEq) return a.pyEq(b);
  if (isHost(b) && (b as PyHost).pyEq) return (b as PyHost).pyEq!(a);
  if (a instanceof PyPattern && b instanceof PyPattern) return a.pattern === b.pattern && a.flags === b.flags;
  return false;
}

// ---------- JS ↔ Python conversion at the Playwright boundary ----------

/** Python value → plain JS (dicts become objects, tuples arrays, patterns RegExp). */
export function toJs(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v instanceof PyDict) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of v.items()) o[String(k)] = toJs(x);
    return o;
  }
  if (Array.isArray(v)) return v.map(toJs);
  if (v instanceof PyPattern) return v.re;
  if (v instanceof PySet) return v.values().map(toJs);
  return v;
}

/** JS value → Python (objects become dicts). */
export function fromJs(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(fromJs);
  if (v instanceof RegExp) return v;
  if (Object.getPrototypeOf(v) === Object.prototype) {
    const d = new PyDict();
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) d.set(k, fromJs(x));
    return d;
  }
  return v;
}
