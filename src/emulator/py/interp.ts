// Async tree-walking interpreter for the Python subset. Every call is awaited, so the synchronous
// Playwright-for-Python API maps onto the emulator's asynchronous Page/Locator objects.
import type { Expr, Module, Param, Stmt } from './ast';
import { srcOf } from './ast';
import type { FunctionDefNode } from './interp-types';
import { parseModule } from './parser';
import { PySyntaxError } from './errors';
import {
  PyBoundMethod, PyBuiltin, PyClass, PyClassMethod, PyDict, PyException, PyFunction, PyInstance, PyModule, PyPattern,
  PyProperty, PyRange, PySet, PyStaticMethod, fmtFloat, hashKey, isHost, isList, isTuple, pyEq, repr, str, truthy, tuple,
  typeName, type PyHost, type TraceEntry,
} from './values';
import { formatSpec } from './format';

// ---------- scopes ----------

export class Scope {
  vars = new Map<string, unknown>();
  parent: Scope | null;
  module: ModuleCtx;
  kind: 'module' | 'function' | 'class' | 'comp';
  globalNames?: Set<string>;
  nonlocalNames?: Set<string>;
  /** generator functions: where `yield` sends values */
  onYield?: (v: unknown) => Promise<unknown>;
  fnName = '<module>';
  constructor(kind: Scope['kind'], parent: Scope | null, module: ModuleCtx) {
    this.kind = kind;
    this.parent = parent;
    this.module = module;
  }
}

export interface ModuleCtx {
  mod: PyModule;
  ast: Module;
  file: string;
  /** dotted module name, e.g. "pages.login_page" */
  name: string;
  package: string;
}

interface Frame { file: string; line: number; name: string; cls?: PyClass; self?: unknown }

type Signal = { k: 'break' } | { k: 'continue' } | { k: 'return'; v: unknown } | undefined;

/** Errors that Python code must not be able to catch (test closed, run aborted, loop guard). */
export function isUncatchable(e: unknown): boolean {
  return !!e && typeof e === 'object' && ((e as { code?: string }).code === 'closed' || (e as { uncatchable?: boolean }).uncatchable === true);
}

export interface InterpHooks {
  print: (text: string) => void;
  loopGuard: () => void;
  checkAlive: () => void;
  /** converts an error thrown by JS (Playwright emulator) into a Python exception */
  convertError: (e: unknown) => PyException | null;
  /** files of the project: path → source */
  files: Record<string, string>;
  /** built-in modules by dotted name */
  builtinModule: (name: string) => PyModule | null;
}

export class Interp {
  builtins: Map<string, unknown>;
  hooks: InterpHooks;
  modules = new Map<string, PyModule>();
  moduleCtx = new Map<PyModule, ModuleCtx>();
  frames: Frame[] = [];
  excStack: PyException[] = [];
  depth = 0;
  E: Record<string, PyClass>;
  /** attribute getters for built-in value types (re.Pattern.pattern, …) */
  typeAttrs: Record<string, Record<string, (obj: never) => unknown>> = {};
  /** extra method tables for built-in value types */
  extraMethods: Record<string, Record<string, (self: never, args: unknown[], kwargs: Map<string, unknown>) => unknown>> = {};

  constructor(builtins: Map<string, unknown>, exceptions: Record<string, PyClass>, hooks: InterpHooks) {
    this.builtins = builtins;
    this.E = exceptions;
    this.hooks = hooks;
  }

  // ---------- errors ----------
  /** Creates a Python exception of class `name` with a message. */
  err(name: string, msg?: string): PyException {
    const cls = this.E[name] ?? this.E.Exception;
    const inst = new PyInstance(cls);
    inst.dict.set('args', msg === undefined ? [] : [msg]);
    const e = new PyException(inst);
    e.tb = this.snapshot();
    return e;
  }
  snapshot(): TraceEntry[] {
    return this.frames.map((f) => ({ file: f.file, line: f.line, name: f.name }));
  }
  get top(): Frame { return this.frames[this.frames.length - 1]; }
  /** Current location for Playwright step records. */
  location(onlyFile?: string): { file: string; line: number } | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (!onlyFile || f.file === onlyFile) return { file: f.file, line: f.line };
    }
    return undefined;
  }

  toPy(e: unknown): PyException {
    if (e instanceof PyException) return e;
    if (e instanceof PySyntaxError) {
      const x = this.err(e.kind, e.message);
      x.exc.dict.set('lineno', e.line);
      x.exc.dict.set('filename', e.file);
      x.tb = [{ file: e.file, line: e.line, name: '<module>' }];
      return x;
    }
    const conv = this.hooks.convertError(e);
    if (conv) {
      if (!conv.tb.length) conv.tb = this.snapshot();
      return conv;
    }
    if (e instanceof RangeError && /call stack/i.test(e.message)) return this.err('RecursionError', 'maximum recursion depth exceeded');
    if (e instanceof TypeError) return this.err('TypeError', e.message);
    if (e instanceof RangeError) return this.err('ValueError', e.message);
    if (e instanceof SyntaxError) return this.err('ValueError', e.message);
    return this.err('RuntimeError', e instanceof Error ? e.message : String(e));
  }

  // ---------- modules ----------
  async runModule(name: string, file: string, src: string, preset?: Map<string, unknown>): Promise<PyModule> {
    const ast = parseModule(src, file);
    const mod = new PyModule(name, file);
    if (preset) for (const [k, v] of preset) mod.dict.set(k, v);
    const pkg = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '';
    const ctx: ModuleCtx = { mod, ast, file, name, package: pkg };
    mod.dict.set('__name__', name === '__main__' ? '__main__' : name);
    mod.dict.set('__file__', file);
    this.modules.set(name, mod);
    this.moduleCtx.set(mod, ctx);
    const scope = new Scope('module', null, ctx);
    scope.vars = mod.dict;
    this.frames.push({ file, line: 1, name: '<module>' });
    try {
      await this.execBlock(ast.body, scope);
    } catch (e) {
      this.modules.delete(name);
      if (isUncatchable(e)) throw e;
      throw this.toPy(e);
    } finally {
      this.frames.pop();
    }
    return mod;
  }

  filePathFor(name: string): string | null {
    const base = name.replace(/\./g, '/');
    for (const cand of [`${base}.py`, `${base}/__init__.py`]) if (this.hooks.files[cand] !== undefined) return cand;
    return null;
  }
  isPackageDir(name: string): boolean {
    const prefix = name.replace(/\./g, '/') + '/';
    return Object.keys(this.hooks.files).some((f) => f.startsWith(prefix));
  }

  async importModule(name: string): Promise<PyModule> {
    const cached = this.modules.get(name);
    if (cached) return cached;
    const b = this.hooks.builtinModule(name);
    if (b) { this.modules.set(name, b); return b; }
    // make sure parent packages exist and link the child as an attribute
    const parts = name.split('.');
    if (parts.length > 1) await this.importModule(parts.slice(0, -1).join('.'));
    const path = this.filePathFor(name);
    let mod: PyModule;
    if (path) mod = await this.runModule(name, path, this.hooks.files[path]);
    else if (this.isPackageDir(name)) {
      mod = new PyModule(name);
      this.modules.set(name, mod);
    } else throw this.err('ModuleNotFoundError', `No module named '${name}'`);
    if (parts.length > 1) {
      const parent = this.modules.get(parts.slice(0, -1).join('.'));
      parent?.dict.set(parts[parts.length - 1], mod);
    }
    return mod;
  }

  resolveRelative(module: string, level: number, scope: Scope): string {
    if (!level) return module;
    let pkg = scope.module.package.split('.').filter(Boolean);
    pkg = pkg.slice(0, pkg.length - (level - 1));
    return [...pkg, ...(module ? [module] : [])].join('.');
  }

  // ---------- names ----------
  lookup(name: string, scope: Scope, node: { line: number }): unknown {
    for (let s: Scope | null = scope; s; s = s.parent) {
      if (s.kind === 'class' && s !== scope) continue;
      if (s.vars.has(name)) return s.vars.get(name);
    }
    const g = scope.module.mod.dict;
    if (g.has(name)) return g.get(name);
    if (this.builtins.has(name)) return this.builtins.get(name);
    void node;
    const hint = NAME_HINTS[name];
    throw this.err('NameError', `name '${name}' is not defined${hint ? `. ${hint}` : suggest(name, [...allNames(scope), ...this.builtins.keys()])}`);
  }

  assignName(name: string, value: unknown, scope: Scope) {
    if (scope.globalNames?.has(name)) { scope.module.mod.dict.set(name, value); return; }
    if (scope.nonlocalNames?.has(name)) {
      for (let s = scope.parent; s; s = s.parent) if (s.kind === 'function' && s.vars.has(name)) { s.vars.set(name, value); return; }
    }
    scope.vars.set(name, value);
  }

  // ---------- statements ----------
  async execBlock(body: Stmt[], scope: Scope): Promise<Signal> {
    for (const st of body) {
      const sig = await this.exec(st, scope);
      if (sig) return sig;
    }
    return undefined;
  }

  async exec(st: Stmt, scope: Scope): Promise<Signal> {
    this.hooks.checkAlive();
    if (this.top) this.top.line = st.line;
    switch (st.t) {
      case 'Expr': {
        const v = st.value;
        if (v.t === 'Yield') { await this.eval(v, scope); return undefined; }
        await this.eval(v, scope);
        return undefined;
      }
      case 'Assign': {
        const value = await this.eval(st.value, scope);
        for (const t of st.targets) await this.assign(t, value, scope);
        return undefined;
      }
      case 'AugAssign': {
        if (st.target.t === 'Name') {
          const cur = this.lookup(st.target.id, scope, st);
          const rhs = await this.eval(st.value, scope);
          this.assignName(st.target.id, await this.binop(st.op, cur, rhs, true), scope);
        } else if (st.target.t === 'Attribute') {
          const obj = await this.eval(st.target.value, scope);
          const cur = await this.getAttr(obj, st.target.attr);
          const rhs = await this.eval(st.value, scope);
          await this.setAttr(obj, st.target.attr, await this.binop(st.op, cur, rhs, true));
        } else if (st.target.t === 'Subscript') {
          const obj = await this.eval(st.target.value, scope);
          const key = await this.eval(st.target.slice, scope);
          const cur = await this.getItem(obj, key);
          const rhs = await this.eval(st.value, scope);
          await this.setItem(obj, key, await this.binop(st.op, cur, rhs, true));
        }
        return undefined;
      }
      case 'AnnAssign': {
        if (scope.kind === 'class' && st.target.t === 'Name') scope.vars.set('__annotation__:' + st.target.id, true);
        if (st.value) await this.assign(st.target, await this.eval(st.value, scope), scope);
        return undefined;
      }
      case 'Pass': return undefined;
      case 'Break': return { k: 'break' };
      case 'Continue': return { k: 'continue' };
      case 'Return': return { k: 'return', v: st.value ? await this.eval(st.value, scope) : null };
      case 'Raise': {
        if (!st.exc) {
          const cur = this.excStack[this.excStack.length - 1];
          if (!cur) throw this.err('RuntimeError', 'No active exception to reraise');
          throw cur;
        }
        let exc = await this.eval(st.exc, scope);
        if (exc instanceof PyClass) exc = await this.call(exc, [], new Map());
        if (!(exc instanceof PyInstance) || !exc.cls.isSubclassOf(this.E.BaseException)) throw this.err('TypeError', 'exceptions must derive from BaseException');
        const e = new PyException(exc);
        e.tb = this.snapshot();
        throw e;
      }
      case 'Assert': {
        const ok = await this.assertTest(st, scope);
        if (ok === true) return undefined;
        const msgVal = st.msg ? await this.eval(st.msg, scope) : null;
        const text = (msgVal !== null ? (await this.pyStr(msgVal)) + '\n' : '') + ok.text;
        const e = this.err('AssertionError', text);
        e.exc.dict.set('args', msgVal !== null ? [msgVal] : []);
        e.exc.dict.set('__message__', text);
        e.emu = { code: 'assert-failed', message: `AssertionError: ${text}`, data: { expr: ok.expr, ...ok.data } };
        throw e;
      }
      case 'Del': {
        for (const t of st.targets) {
          if (t.t === 'Name') scope.vars.delete(t.id);
          else if (t.t === 'Subscript') {
            const obj = await this.eval(t.value, scope);
            const key = await this.eval(t.slice, scope);
            if (obj instanceof PyDict) { if (!obj.delete(key)) throw this.err('KeyError', repr(key)); }
            else if (isList(obj)) obj.splice(this.index(obj, key), 1);
          } else if (t.t === 'Attribute') {
            const obj = await this.eval(t.value, scope);
            if (obj instanceof PyInstance) obj.dict.delete(t.attr);
          }
        }
        return undefined;
      }
      case 'Global': (scope.globalNames ??= new Set()); st.names.forEach((n) => scope.globalNames!.add(n)); return undefined;
      case 'Nonlocal': (scope.nonlocalNames ??= new Set()); st.names.forEach((n) => scope.nonlocalNames!.add(n)); return undefined;
      case 'Import': {
        for (const { name, asname } of st.names) {
          const mod = await this.importModule(name);
          if (asname) this.assignName(asname, mod, scope);
          else {
            const top = name.split('.')[0];
            this.assignName(top, this.modules.get(top) ?? mod, scope);
          }
        }
        return undefined;
      }
      case 'ImportFrom': {
        const full = this.resolveRelative(st.module, st.level, scope);
        if (full === '__future__') return undefined;
        const mod = await this.importModule(full);
        for (const { name, asname } of st.names) {
          if (name === '*') {
            for (const [k, v] of mod.dict) if (!k.startsWith('_')) this.assignName(k, v, scope);
            continue;
          }
          let v: unknown;
          if (mod.dict.has(name)) v = mod.dict.get(name);
          else {
            // submodule: from pages import login_page
            const sub = `${full}.${name}`;
            if (this.filePathFor(sub) || this.isPackageDir(sub) || this.hooks.builtinModule(sub)) v = await this.importModule(sub);
            else {
              const where = mod.file ? ` (${mod.file})` : this.hooks.builtinModule(full) ? '' : ' (unknown location)';
              throw this.err('ImportError', `cannot import name '${name}' from '${full}'${where}${suggest(name, [...mod.dict.keys()])}`);
            }
          }
          this.assignName(asname ?? name, v, scope);
        }
        return undefined;
      }
      case 'If': {
        if (truthy(await this.evalTest(st.test, scope))) return this.execBlock(st.body, scope);
        return this.execBlock(st.orelse, scope);
      }
      case 'While': {
        while (truthy(await this.evalTest(st.test, scope))) {
          this.hooks.loopGuard();
          const sig = await this.execBlock(st.body, scope);
          if (sig?.k === 'break') return undefined;
          if (sig?.k === 'return') return sig;
          if (this.top) this.top.line = st.line;
        }
        return this.execBlock(st.orelse, scope);
      }
      case 'For': {
        const iterable = await this.eval(st.iter, scope);
        const items = await this.iterate(iterable);
        for (const item of items) {
          this.hooks.loopGuard();
          await this.assign(st.target, item, scope);
          const sig = await this.execBlock(st.body, scope);
          if (sig?.k === 'break') return undefined;
          if (sig?.k === 'return') return sig;
          if (this.top) this.top.line = st.line;
        }
        return this.execBlock(st.orelse, scope);
      }
      case 'With': return this.execWith(st, 0, scope);
      case 'Try': return this.execTry(st, scope);
      case 'FunctionDef': {
        const fn = await this.makeFunction(st, scope);
        let value: unknown = fn;
        for (const d of [...st.decorators].reverse()) {
          if (this.top) this.top.line = d.line;
          const dec = await this.eval(d, scope);
          value = await this.call(dec, [value], new Map());
        }
        if (this.top) this.top.line = st.line;
        this.assignName(st.name, value, scope);
        return undefined;
      }
      case 'ClassDef': {
        const bases: PyClass[] = [];
        for (const b of st.bases) {
          const v = await this.eval(b, scope);
          if (!(v instanceof PyClass)) throw this.err('TypeError', `bases must be types, not ${typeName(v)}`);
          bases.push(v);
        }
        const cls = new PyClass(st.name, bases.length ? bases : [this.E.object], scope.module.name);
        const cscope = new Scope('class', scope, scope.module);
        cscope.fnName = st.name;
        cscope.vars = cls.dict;
        await this.execBlock(st.body, cscope);
        for (const k of [...cls.dict.keys()]) {
          if (k.startsWith('__annotation__:')) { cls.annotations.push(k.slice(15)); cls.dict.delete(k); }
        }
        for (const v of cls.dict.values()) {
          const f = v instanceof PyStaticMethod || v instanceof PyClassMethod ? v.func : v instanceof PyProperty ? v.fget : v;
          if (f instanceof PyFunction) f.attrs.set('__class__', cls);
          if (v instanceof PyProperty && v.fset instanceof PyFunction) v.fset.attrs.set('__class__', cls);
        }
        let value: unknown = cls;
        for (const d of [...st.decorators].reverse()) value = await this.call(await this.eval(d, scope), [value], new Map());
        this.assignName(st.name, value, scope);
        return undefined;
      }
    }
    return undefined;
  }

  async evalTest(e: Expr, scope: Scope): Promise<unknown> {
    if (this.top) this.top.line = e.line;
    return this.eval(e, scope);
  }

  /** Evaluates an assert; returns true or a pytest-like explanation. */
  async assertTest(st: Extract<Stmt, { t: 'Assert' }>, scope: Scope): Promise<true | { text: string; expr: string; data: Record<string, string> }> {
    const mod = scope.module.ast;
    const test = st.test;
    const exprSrc = srcOf(mod, test);
    const where = (node: Expr, val: unknown): string | null => {
      if (node.t === 'Const' || node.t === 'Name' || node.t === 'List' || node.t === 'Tuple' || node.t === 'Dict') return null;
      return ` +  where ${repr(val)} = ${srcOf(mod, node)}`;
    };
    if (test.t === 'Compare' && test.ops.length === 1) {
      const left = await this.eval(test.left, scope);
      const right = await this.eval(test.comparators[0], scope);
      if (truthy(await this.compare(test.ops[0], left, right))) return true;
      const lines = [`assert ${repr(left)} ${test.ops[0]} ${repr(right)}`];
      const wl = where(test.left, left);
      const wr = where(test.comparators[0], right);
      if (wl) lines.push(wl);
      if (wr) lines.push(wr);
      return { text: lines.join('\n'), expr: exprSrc, data: { left: repr(left), right: repr(right), op: test.ops[0] } };
    }
    if (test.t === 'UnaryOp' && test.op === 'not') {
      const v = await this.eval(test.operand, scope);
      if (!truthy(v)) return true;
      const lines = [`assert not ${repr(v)}`];
      const w = where(test.operand, v);
      if (w) lines.push(w);
      return { text: lines.join('\n'), expr: exprSrc, data: { value: repr(v) } };
    }
    const v = await this.eval(test, scope);
    if (truthy(v)) return true;
    const lines = [`assert ${repr(v)}`];
    const w = where(test, v);
    if (w) lines.push(w);
    return { text: lines.join('\n'), expr: exprSrc, data: { value: repr(v) } };
  }

  async execWith(st: Extract<Stmt, { t: 'With' }>, i: number, scope: Scope): Promise<Signal> {
    if (i >= st.items.length) return this.execBlock(st.body, scope);
    const item = st.items[i];
    if (this.top) this.top.line = st.line;
    const mgr = await this.eval(item.ctx, scope);
    let entered: unknown;
    let exit: (e: PyException | null) => Promise<boolean>;
    if (mgr instanceof PyInstance && mgr.cls.has('__enter__')) {
      entered = await this.callMethod(mgr, '__enter__', []);
      exit = async (e) => truthy(await this.callMethod(mgr, '__exit__', e ? [e.cls, e.exc, null] : [null, null, null]));
    } else if (isHost(mgr) && mgr.pyEnter) {
      entered = await mgr.pyEnter();
      exit = async (e) => !!(await mgr.pyExit?.(e));
    } else {
      throw this.err('TypeError', `'${typeName(mgr)}' object does not support the context manager protocol`);
    }
    if (item.vars) await this.assign(item.vars, entered, scope);
    let sig: Signal;
    try {
      sig = await this.execWith(st, i + 1, scope);
    } catch (e) {
      if (isUncatchable(e)) throw e;
      const pe = this.toPy(e);
      if (await exit(pe)) return undefined;
      throw pe;
    }
    await exit(null);
    return sig;
  }

  async execTry(st: Extract<Stmt, { t: 'Try' }>, scope: Scope): Promise<Signal> {
    let sig: Signal;
    try {
      try {
        sig = await this.execBlock(st.body, scope);
      } catch (e) {
        if (isUncatchable(e)) throw e;
        const pe = this.toPy(e);
        for (const h of st.handlers) {
          let match = !h.type;
          if (h.type) {
            const t = await this.eval(h.type, scope);
            const classes = Array.isArray(t) ? t : [t];
            match = classes.some((c) => c instanceof PyClass && pe.cls.isSubclassOf(c));
          }
          if (match) {
            if (h.name) this.assignName(h.name, pe.exc, scope);
            this.excStack.push(pe);
            try {
              return await this.execBlock(h.body, scope);
            } finally {
              this.excStack.pop();
              if (h.name) scope.vars.delete(h.name);
            }
          }
        }
        throw pe;
      }
      if (st.orelse.length) sig = await this.execBlock(st.orelse, scope);
      return sig;
    } finally {
      if (st.finalbody.length) {
        const fsig = await this.execBlock(st.finalbody, scope);
        // a return/break in finally overrides (rare; keep Python semantics)
        if (fsig) return fsig; // eslint-disable-line no-unsafe-finally
      }
    }
  }

  async assign(target: Expr, value: unknown, scope: Scope): Promise<void> {
    switch (target.t) {
      case 'Name': this.assignName(target.id, value, scope); return;
      case 'Attribute': await this.setAttr(await this.eval(target.value, scope), target.attr, value); return;
      case 'Subscript': await this.setItem(await this.eval(target.value, scope), await this.eval(target.slice, scope), value); return;
      case 'Tuple': case 'List': {
        const items = await this.iterate(value);
        const star = target.elts.findIndex((e) => e.t === 'Starred');
        if (star < 0) {
          if (items.length !== target.elts.length) {
            throw this.err('ValueError', items.length > target.elts.length
              ? `too many values to unpack (expected ${target.elts.length})`
              : `not enough values to unpack (expected ${target.elts.length}, got ${items.length})`);
          }
          for (let i = 0; i < items.length; i++) await this.assign(target.elts[i], items[i], scope);
          return;
        }
        const after = target.elts.length - star - 1;
        if (items.length < target.elts.length - 1) throw this.err('ValueError', `not enough values to unpack (expected at least ${target.elts.length - 1}, got ${items.length})`);
        for (let i = 0; i < star; i++) await this.assign(target.elts[i], items[i], scope);
        await this.assign((target.elts[star] as Extract<Expr, { t: 'Starred' }>).value, items.slice(star, items.length - after), scope);
        for (let i = 0; i < after; i++) await this.assign(target.elts[star + 1 + i], items[items.length - after + i], scope);
        return;
      }
      default:
        throw this.err('SyntaxError', 'cannot assign to expression');
    }
  }

  // ---------- functions ----------
  async makeFunction(st: Extract<Stmt, { t: 'FunctionDef' }>, scope: Scope): Promise<PyFunction> {
    const defaults = new Map<string, unknown>();
    for (const p of st.args.list) if (p.default) defaults.set(p.name, await this.eval(p.default, scope));
    const node: FunctionDefNode = { name: st.name, args: st.args, body: st.body, isGenerator: st.isGenerator, line: st.line, file: scope.module.file, isLambda: false };
    const qual = scope.kind === 'class' ? `${scope.fnName}.${st.name}` : st.name;
    const fn = new PyFunction(st.name, qual, node, scope, defaults, scope.module.name, scope.module.file);
    if (st.isAsync) fn.attrs.set('__async__', true);
    return fn;
  }

  bindArgs(fn: PyFunction, args: unknown[], kwargs: Map<string, unknown>, selfOffset: number): Map<string, unknown> {
    const params = fn.node.args.list;
    const out = new Map<string, unknown>();
    const fname = `${fn.qualname}()`;
    const pos = params.filter((p) => p.kind === 'pos');
    const vararg = params.find((p) => p.kind === 'vararg');
    const kwarg = params.find((p) => p.kind === 'kwarg');
    if (args.length > pos.length && !vararg) {
      const req = pos.filter((p) => !fn.defaults.has(p.name)).length - selfOffset;
      const total = pos.length - selfOffset;
      const takes = req === total ? `${total}` : `from ${req} to ${total}`;
      throw this.err('TypeError', `${fname} takes ${takes} positional argument${total === 1 ? '' : 's'} but ${args.length - selfOffset} ${args.length - selfOffset === 1 ? 'was' : 'were'} given`);
    }
    pos.forEach((p, i) => { if (i < args.length) out.set(p.name, args[i]); });
    if (vararg) out.set(vararg.name, tuple(args.slice(pos.length)));
    const extra = new PyDict();
    for (const [k, v] of kwargs) {
      const p = params.find((x) => x.name === k && (x.kind === 'pos' || x.kind === 'kwonly'));
      if (p) {
        if (out.has(k)) throw this.err('TypeError', `${fname} got multiple values for argument '${k}'`);
        out.set(k, v);
      } else if (kwarg) extra.set(k, v);
      else throw this.err('TypeError', `${fname} got an unexpected keyword argument '${k}'${suggest(k, params.map((x) => x.name))}`);
    }
    if (kwarg) out.set(kwarg.name, extra);
    const missing: Param[] = [];
    for (const p of params) {
      if (p.kind === 'vararg' || p.kind === 'kwarg' || out.has(p.name)) continue;
      if (fn.defaults.has(p.name)) out.set(p.name, fn.defaults.get(p.name));
      else missing.push(p);
    }
    if (missing.length) {
      const kind = missing[0].kind === 'kwonly' ? 'keyword-only' : 'positional';
      const names = missing.map((p) => `'${p.name}'`);
      const list = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
      throw this.err('TypeError', `${fname} missing ${missing.length} required ${kind} argument${missing.length === 1 ? '' : 's'}: ${list}`);
    }
    return out;
  }

  /** Runs a Python function. `onYield` runs generator functions step by step (pytest fixtures). */
  async callFunction(fn: PyFunction, args: unknown[], kwargs: Map<string, unknown>, selfOffset = 0, onYield?: (v: unknown) => Promise<unknown>): Promise<unknown> {
    const bound = this.bindArgs(fn, args, kwargs, selfOffset);
    if (++this.depth > 200) {
      this.depth--;
      throw this.err('RecursionError', 'maximum recursion depth exceeded');
    }
    const scope = new Scope('function', fn.closure as Scope, (fn.closure as Scope).module);
    scope.fnName = fn.name;
    for (const [k, v] of bound) scope.vars.set(k, v);
    let collected: unknown[] | null = null;
    if (fn.node.isGenerator) {
      if (onYield) scope.onYield = onYield;
      else {
        collected = [];
        const sink = collected;
        scope.onYield = async (v) => { sink.push(v); return null; };
      }
    }
    const owner = fn.attrs.get('__class__');
    this.frames.push({ file: fn.file, line: fn.node.line, name: fn.name, cls: owner instanceof PyClass ? owner : undefined, self: args[0] });
    try {
      if (fn.node.isLambda) return await this.eval(fn.node.body as Expr, scope);
      const sig = await this.execBlock(fn.node.body as Stmt[], scope);
      if (collected) return new PyGenerator(collected);
      return sig?.k === 'return' ? sig.v : null;
    } finally {
      this.frames.pop();
      this.depth--;
    }
  }

  async call(f: unknown, args: unknown[], kwargs: Map<string, unknown>): Promise<unknown> {
    if (f instanceof PyFunction) return this.callFunction(f, args, kwargs);
    if (f instanceof PyBoundMethod) {
      if (f.func instanceof PyFunction) return this.callFunction(f.func, [f.self, ...args], kwargs, 1);
      return this.callNative(f.func, [f.self, ...args], kwargs);
    }
    if (f instanceof PyBuiltin) return this.callNative(f, args, kwargs);
    if (f instanceof PyClass) return this.instantiate(f, args, kwargs);
    if (f instanceof PyInstance) {
      const c = f.cls.lookup('__call__');
      if (c) return this.call(new PyBoundMethod(f, c as PyFunction), args, kwargs);
    }
    if (f instanceof PyStaticMethod) return this.call(f.func, args, kwargs);
    if (isHost(f) && f.pyCall) {
      try { return await f.pyCall(args, kwargs); } catch (e) { if (isUncatchable(e)) throw e; throw this.toPy(e); }
    }
    throw this.err('TypeError', `'${typeName(f)}' object is not callable`);
  }

  async callNative(f: PyBuiltin, args: unknown[], kwargs: Map<string, unknown>): Promise<unknown> {
    try {
      const r = f.fn(args, kwargs);
      return r && typeof (r as PromiseLike<unknown>).then === 'function' ? await r : r;
    } catch (e) {
      if (isUncatchable(e)) throw e;
      throw this.toPy(e);
    }
  }

  async callMethod(obj: unknown, name: string, args: unknown[], kwargs = new Map<string, unknown>()): Promise<unknown> {
    return this.call(await this.getAttr(obj, name), args, kwargs);
  }

  async instantiate(cls: PyClass, args: unknown[], kwargs: Map<string, unknown>): Promise<unknown> {
    if (cls.native) {
      try { return await cls.native(args, kwargs); } catch (e) { if (isUncatchable(e)) throw e; throw this.toPy(e); }
    }
    const inst = new PyInstance(cls);
    if (cls.isSubclassOf(this.E.BaseException)) inst.dict.set('args', args);
    const init = cls.lookup('__init__');
    if (init instanceof PyFunction) {
      await this.callFunction(init, [inst, ...args], kwargs, 1);
    } else if (init instanceof PyBuiltin) {
      await this.callNative(init, [inst, ...args], kwargs);
    } else if ((args.length || kwargs.size) && !cls.isSubclassOf(this.E.BaseException)) {
      throw this.err('TypeError', `${cls.name}() takes no arguments`);
    }
    return inst;
  }

  // ---------- attributes ----------
  async getAttr(obj: unknown, name: string): Promise<unknown> {
    const v = await this.getAttrOpt(obj, name);
    if (v !== MISSING) return v;
    throw this.attrError(obj, name);
  }

  attrError(obj: unknown, name: string): PyException {
    if (obj instanceof PyModule) return this.err('AttributeError', `module '${obj.name}' has no attribute '${name}'${suggest(name, [...obj.dict.keys()])}`);
    if (obj instanceof PyClass) return this.err('AttributeError', `type object '${obj.name}' has no attribute '${name}'${suggest(name, obj.mro.flatMap((c) => [...c.dict.keys()]))}`);
    let names: string[] = [];
    if (obj instanceof PyInstance) names = [...obj.dict.keys(), ...obj.cls.mro.flatMap((c) => [...c.dict.keys()])];
    else if (isHost(obj)) names = (obj as PyHost & { pyDir?: () => string[] }).pyDir?.() ?? [];
    else names = TYPE_METHODS[typeName(obj)] ?? [];
    const snake = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const hint = snake !== name && names.includes(snake) ? `. Did you mean: '${snake}'?` : suggest(name, names);
    return this.err('AttributeError', `'${typeName(obj)}' object has no attribute '${name}'${hint}`);
  }

  async getAttrOpt(obj: unknown, name: string): Promise<unknown> {
    if (obj instanceof PyInstance) {
      if (name === '__class__') return obj.cls;
      if (name === '__dict__') return PyDict.from([...obj.dict].filter(([k]) => k !== 'args' || true));
      if (obj.dict.has(name)) return obj.dict.get(name);
      const v = obj.cls.lookup(name);
      if (v !== undefined) return this.bindFromClass(v, obj, obj.cls);
      return MISSING;
    }
    if (obj instanceof PyClass) {
      if (name === '__name__') return obj.name;
      const v = obj.lookup(name);
      if (v instanceof PyClassMethod) return new PyBoundMethod(obj, v.func as PyFunction);
      if (v instanceof PyStaticMethod) return v.func;
      return v === undefined ? MISSING : v;
    }
    if (obj instanceof PyModule) return obj.dict.has(name) ? obj.dict.get(name) : MISSING;
    if (isHost(obj)) {
      const v = await obj.pyGetAttr(name);
      return v === undefined ? MISSING : v;
    }
    if (obj instanceof PyFunction) {
      if (name === '__name__') return obj.name;
      if (obj.attrs.has(name)) return obj.attrs.get(name);
      return MISSING;
    }
    if (obj instanceof PyBuiltin) {
      if (name === '__name__') return obj.name;
      return obj.attrs.has(name) ? obj.attrs.get(name) : MISSING;
    }
    if (obj instanceof PyProperty && name === 'setter') {
      return new PyBuiltin('setter', (a) => new PyProperty(obj.fget, a[0]));
    }
    const extra = this.typeAttrs[typeName(obj)]?.[name];
    if (extra) return extra(obj as never);
    if (obj instanceof PyBoundMethod) {
      if (name === '__name__') return obj.func.name;
      if (name === '__self__') return obj.self;
      return MISSING;
    }
    const m = this.typeMethod(obj, name);
    return m === undefined ? MISSING : m;
  }

  bindFromClass(v: unknown, inst: PyInstance, cls: PyClass): unknown | Promise<unknown> {
    if (v instanceof PyFunction || v instanceof PyBuiltin) return new PyBoundMethod(inst, v);
    if (v instanceof PyStaticMethod) return v.func;
    if (v instanceof PyClassMethod) return new PyBoundMethod(cls, v.func as PyFunction);
    if (v instanceof PyProperty) return this.call(v.fget, [inst], new Map());
    return v;
  }

  async setAttr(obj: unknown, name: string, value: unknown): Promise<void> {
    if (obj instanceof PyInstance) {
      const prop = obj.cls.lookup(name);
      if (prop instanceof PyProperty) {
        if (!prop.fset) throw this.err('AttributeError', `property '${name}' of '${obj.cls.name}' object has no setter`);
        await this.call(prop.fset, [obj, value], new Map());
        return;
      }
      obj.dict.set(name, value);
      return;
    }
    if (obj instanceof PyClass) { obj.dict.set(name, value); return; }
    if (obj instanceof PyModule) { obj.dict.set(name, value); return; }
    if (obj instanceof PyFunction) { obj.attrs.set(name, value); return; }
    if (isHost(obj)) throw this.err('AttributeError', `'${obj.pyType}' object attribute '${name}' is read-only`);
    throw this.err('AttributeError', `'${typeName(obj)}' object has no attribute '${name}'`);
  }

  typeMethod(obj: unknown, name: string): unknown {
    const tbl = typeMethods(this);
    const t = typeName(obj);
    const key = t === 'bool' ? 'int' : t;
    const impl = tbl[key]?.[name] ?? this.extraMethods[key]?.[name];
    if (!impl) return undefined;
    return new PyBuiltin(name, (args, kwargs) => impl(obj as never, args, kwargs), t);
  }

  // ---------- items ----------
  index(seq: { length: number }, key: unknown): number {
    if (typeof key === 'boolean') key = key ? 1 : 0;
    if (typeof key !== 'number' || !Number.isInteger(key)) throw this.err('TypeError', `${typeName(seq)} indices must be integers or slices, not ${typeName(key)}`);
    const i = key < 0 ? seq.length + key : key;
    return i;
  }

  async getItem(obj: unknown, key: unknown): Promise<unknown> {
    if (key instanceof SliceVal) {
      if (key.step === 0) throw this.err('ValueError', 'slice step cannot be zero');
      if (typeof obj === 'string') { const chars = [...obj]; return key.indices(chars.length).map((i) => chars[i]).join(''); }
      if (Array.isArray(obj)) {
        const r = key.indices(obj.length).map((i) => obj[i]);
        return isTuple(obj) ? tuple(r) : r;
      }
    }
    if (Array.isArray(obj) || typeof obj === 'string') {
      const seq = typeof obj === 'string' ? [...obj] : obj;
      const i = this.index(seq, key);
      if (i < 0 || i >= seq.length) throw this.err('IndexError', `${typeName(obj) === 'str' ? 'string' : typeName(obj)} index out of range`);
      return seq[i];
    }
    if (obj instanceof PyDict) {
      if (!obj.has(key)) throw this.err('KeyError', repr(key)).withArgs([key]);
      return obj.get(key);
    }
    if (obj instanceof PyRange) {
      const vals = obj.values();
      const i = this.index(vals, key);
      if (i < 0 || i >= vals.length) throw this.err('IndexError', 'range object index out of range');
      return vals[i];
    }
    if (obj instanceof PyInstance && obj.cls.has('__getitem__')) return this.callMethod(obj, '__getitem__', [key]);
    if (obj instanceof PyClass) return obj; // typing: list[str], Generator[...]
    if (isHost(obj) && (obj as PyHost & { pyGetItem?: (k: unknown) => unknown }).pyGetItem) return (obj as PyHost & { pyGetItem: (k: unknown) => unknown }).pyGetItem(key);
    if (obj === null) throw this.err('TypeError', "'NoneType' object is not subscriptable");
    throw this.err('TypeError', `'${typeName(obj)}' object is not subscriptable`);
  }

  async setItem(obj: unknown, key: unknown, value: unknown): Promise<void> {
    if (isList(obj)) {
      const i = this.index(obj, key);
      if (i < 0 || i >= obj.length) throw this.err('IndexError', 'list assignment index out of range');
      obj[i] = value;
      return;
    }
    if (obj instanceof PyDict) { obj.set(key, value); return; }
    if (obj instanceof PyInstance && obj.cls.has('__setitem__')) { await this.callMethod(obj, '__setitem__', [key, value]); return; }
    throw this.err('TypeError', `'${typeName(obj)}' object does not support item assignment`);
  }

  // ---------- iteration ----------
  async iterate(v: unknown): Promise<unknown[]> {
    if (typeof v === 'string') return [...v];
    if (Array.isArray(v)) return [...v];
    if (v instanceof PyDict) return v.keys();
    if (v instanceof PySet) return v.values();
    if (v instanceof PyRange) return v.values();
    if (v instanceof PyGenerator) return v.drain();
    if (isHost(v) && v.pyIter) return v.pyIter();
    if (v instanceof PyInstance && v.cls.has('__iter__')) return this.iterate(await this.callMethod(v, '__iter__', []));
    throw this.err('TypeError', `'${typeName(v)}' object is not iterable`);
  }

  // ---------- operators ----------
  async binop(op: string, a: unknown, b: unknown, inplace = false): Promise<unknown> {
    const num = (x: unknown) => typeof x === 'number' || typeof x === 'boolean';
    if (num(a) && num(b)) {
      const x = Number(a);
      const y = Number(b);
      switch (op) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        case '/': if (y === 0) throw this.err('ZeroDivisionError', 'division by zero'); return x / y;
        case '//': if (y === 0) throw this.err('ZeroDivisionError', 'integer division or modulo by zero'); return Math.floor(x / y);
        case '%': if (y === 0) throw this.err('ZeroDivisionError', 'integer modulo by zero'); return ((x % y) + y) % y;
        case '**': return x ** y;
        case '&': return x & y;
        case '|': return x | y;
        case '^': return x ^ y;
        case '<<': return x << y;
        case '>>': return x >> y;
      }
    }
    if (op === '+') {
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (isList(a) && isList(b)) { if (inplace) { a.push(...b); return a; } return [...a, ...b]; }
      if (isList(a) && inplace && Array.isArray(b)) { a.push(...b); return a; }
      if (isTuple(a) && isTuple(b)) return tuple([...a, ...b]);
      if (typeof a === 'string') throw this.err('TypeError', `can only concatenate str (not "${typeName(b)}") to str`);
      if (isList(a)) throw this.err('TypeError', `can only concatenate list (not "${typeName(b)}") to list`);
    }
    if (op === '*') {
      if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b));
      if (typeof b === 'string' && typeof a === 'number') return b.repeat(Math.max(0, a));
      if (Array.isArray(a) && typeof b === 'number') { const r = Array.from({ length: Math.max(0, b) }, () => a).flat(); return isTuple(a) ? tuple(r) : r; }
    }
    if (op === '%' && typeof a === 'string') return percentFormat(a, b);
    if (op === '|' && a instanceof PyDict && b instanceof PyDict) return PyDict.from([...a.items(), ...b.items()]);
    if (op === '-' && a instanceof PySet && b instanceof PySet) return new PySet(a.values().filter((x) => !b.has(x)));
    if (isHost(a) && a.pyBinop) {
      const r = a.pyBinop(op, b);
      if (r !== undefined) return r;
    }
    if (a instanceof PyInstance) {
      const dunder = { '+': '__add__', '-': '__sub__', '*': '__mul__', '/': '__truediv__' }[op];
      if (dunder && a.cls.has(dunder)) return this.callMethod(a, dunder, [b]);
    }
    throw this.err('TypeError', `unsupported operand type(s) for ${op}${inplace ? '=' : ''}: '${typeName(a)}' and '${typeName(b)}'`);
  }

  async compare(op: string, a: unknown, b: unknown): Promise<boolean> {
    switch (op) {
      case '==': return this.eq(a, b);
      case '!=': return !(await this.eq(a, b));
      case 'is': return a === b || (a === null && b === undefined) || (a === undefined && b === null);
      case 'is not': return !(a === b || (a == null && b == null));
      case 'in': return this.contains(b, a);
      case 'not in': return !(await this.contains(b, a));
    }
    return this.order(op, a, b);
  }

  async eq(a: unknown, b: unknown): Promise<boolean> {
    if (a instanceof PyInstance && a.cls.has('__eq__')) return truthy(await this.callMethod(a, '__eq__', [b]));
    if (b instanceof PyInstance && b.cls.has('__eq__')) return truthy(await this.callMethod(b, '__eq__', [a]));
    return pyEq(a, b);
  }

  order(op: string, a: unknown, b: unknown): boolean {
    const cmp = this.cmp(a, b, op);
    switch (op) {
      case '<': return cmp < 0;
      case '>': return cmp > 0;
      case '<=': return cmp <= 0;
      case '>=': return cmp >= 0;
    }
    return false;
  }

  cmp(a: unknown, b: unknown, op = '<'): number {
    const num = (x: unknown) => typeof x === 'number' || typeof x === 'boolean';
    if (num(a) && num(b)) return Number(a) - Number(b);
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if (Array.isArray(a) && Array.isArray(b) && isTuple(a) === isTuple(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (!pyEq(a[i], b[i])) return this.cmp(a[i], b[i], op);
      }
      return a.length - b.length;
    }
    throw this.err('TypeError', `'${op}' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
  }

  async contains(container: unknown, item: unknown): Promise<boolean> {
    if (typeof container === 'string') {
      if (typeof item !== 'string') throw this.err('TypeError', `'in <string>' requires string as left operand, not ${typeName(item)}`);
      return container.includes(item);
    }
    if (Array.isArray(container)) {
      for (const x of container) if (await this.eq(x, item)) return true;
      return false;
    }
    if (container instanceof PyDict) return container.has(item);
    if (container instanceof PySet) return container.has(item);
    if (container instanceof PyRange) return container.values().includes(item as number);
    if (container instanceof PyInstance && container.cls.has('__contains__')) return truthy(await this.callMethod(container, '__contains__', [item]));
    if (container === null) throw this.err('TypeError', "argument of type 'NoneType' is not iterable");
    const items = await this.iterate(container);
    return items.some((x) => pyEq(x, item));
  }

  // ---------- str / repr with dunders ----------
  async pyStr(v: unknown): Promise<string> {
    if (v instanceof PyInstance) {
      const s = v.cls.lookup('__str__');
      if (s instanceof PyFunction) return String(await this.callFunction(s, [v], new Map(), 1));
      const r = v.cls.lookup('__repr__');
      if (r instanceof PyFunction) return String(await this.callFunction(r, [v], new Map(), 1));
    }
    if (Array.isArray(v) || v instanceof PyDict) return this.pyRepr(v);
    return str(v);
  }
  async pyRepr(v: unknown): Promise<string> {
    if (v instanceof PyInstance) {
      const r = v.cls.lookup('__repr__');
      if (r instanceof PyFunction) return String(await this.callFunction(r, [v], new Map(), 1));
    }
    if (Array.isArray(v) && v.some((x) => x instanceof PyInstance)) {
      const parts = await Promise.all(v.map((x) => this.pyRepr(x)));
      return isTuple(v) ? (v.length === 1 ? `(${parts[0]},)` : `(${parts.join(', ')})`) : `[${parts.join(', ')}]`;
    }
    return repr(v);
  }

  // ---------- expressions ----------
  async eval(e: Expr, scope: Scope): Promise<unknown> {
    switch (e.t) {
      case 'Const': return e.value;
      case 'Name': return this.lookup(e.id, scope, e);
      case 'FString': {
        let out = '';
        for (const p of e.parts) {
          if (typeof p === 'string') { out += p; continue; }
          const v = await this.eval(p.expr, scope);
          const spec = p.spec === undefined ? '' : typeof p.spec === 'string' ? p.spec : String(await this.eval(p.spec, scope));
          if (p.conv === 'r') out += formatSpec(await this.pyRepr(v), spec, this);
          else if (p.conv === 's') out += formatSpec(await this.pyStr(v), spec, this);
          else if (spec) out += formatSpec(v, spec, this);
          else out += await this.pyStr(v);
        }
        return out;
      }
      case 'List': return this.evalElts(e.elts, scope);
      case 'Tuple': return tuple(await this.evalElts(e.elts, scope));
      case 'Set': return new PySet(await this.evalElts(e.elts, scope));
      case 'Dict': {
        const d = new PyDict();
        for (let i = 0; i < e.keys.length; i++) {
          const k = e.keys[i];
          if (k === null) {
            const other = await this.eval(e.values[i], scope);
            if (!(other instanceof PyDict)) throw this.err('TypeError', `'${typeName(other)}' object is not a mapping`);
            for (const [kk, vv] of other.items()) d.set(kk, vv);
          } else {
            const key = await this.eval(k, scope);
            try { d.set(key, await this.eval(e.values[i], scope)); } catch (err) { if (err instanceof TypeError) throw this.err('TypeError', err.message); throw err; }
          }
        }
        return d;
      }
      case 'Starred': throw this.err('SyntaxError', "can't use starred expression here");
      case 'Attribute': {
        const obj = await this.eval(e.value, scope);
        return this.getAttr(obj, e.attr);
      }
      case 'Subscript': {
        const obj = await this.eval(e.value, scope);
        const key = await this.eval(e.slice, scope);
        return this.getItem(obj, key);
      }
      case 'Slice': {
        const lo = e.lower ? await this.eval(e.lower, scope) : null;
        const hi = e.upper ? await this.eval(e.upper, scope) : null;
        const st = e.step ? await this.eval(e.step, scope) : null;
        return new SliceVal(lo as number | null, hi as number | null, (st as number | null) ?? 1);
      }
      case 'Call': {
        const f = await this.eval(e.func, scope);
        const args: unknown[] = [];
        for (const a of e.args) {
          if (a.t === 'Starred') args.push(...(await this.iterate(await this.eval(a.value, scope))));
          else args.push(await this.eval(a, scope));
        }
        const kwargs = new Map<string, unknown>();
        for (const k of e.keywords) {
          const v = await this.eval(k.value, scope);
          if (k.arg === null) {
            if (!(v instanceof PyDict)) throw this.err('TypeError', `argument after ** must be a mapping, not ${typeName(v)}`);
            for (const [kk, vv] of v.items()) kwargs.set(String(kk), vv);
          } else kwargs.set(k.arg, v);
        }
        if (this.top) this.top.line = e.line;
        return this.call(f, args, kwargs);
      }
      case 'BinOp': {
        const a = await this.eval(e.left, scope);
        const b = await this.eval(e.right, scope);
        return this.binop(e.op, a, b);
      }
      case 'UnaryOp': {
        const v = await this.eval(e.operand, scope);
        if (e.op === 'not') return !truthy(v);
        if (typeof v !== 'number' && typeof v !== 'boolean') throw this.err('TypeError', `bad operand type for unary ${e.op}: '${typeName(v)}'`);
        if (e.op === '-') return -Number(v);
        if (e.op === '+') return Number(v);
        if (e.op === '~') return ~Number(v);
        return v;
      }
      case 'BoolOp': {
        let v: unknown = null;
        for (const x of e.values) {
          v = await this.eval(x, scope);
          if (e.op === 'and' ? !truthy(v) : truthy(v)) return v;
        }
        return v;
      }
      case 'Compare': {
        let left = await this.eval(e.left, scope);
        for (let i = 0; i < e.ops.length; i++) {
          const right = await this.eval(e.comparators[i], scope);
          if (!(await this.compare(e.ops[i], left, right))) return false;
          left = right;
        }
        return true;
      }
      case 'IfExp': return truthy(await this.eval(e.test, scope)) ? this.eval(e.body, scope) : this.eval(e.orelse, scope);
      case 'Lambda': {
        const defaults = new Map<string, unknown>();
        for (const p of e.args.list) if (p.default) defaults.set(p.name, await this.eval(p.default, scope));
        const node: FunctionDefNode = { name: '<lambda>', args: e.args, body: e.body, isGenerator: false, line: e.line, file: scope.module.file, isLambda: true };
        return new PyFunction('<lambda>', '<lambda>', node, scope, defaults, scope.module.name, scope.module.file);
      }
      case 'Comp': {
        const cs = new Scope('comp', scope, scope.module);
        cs.fnName = scope.fnName;
        const out: unknown[] = [];
        const dict = new PyDict();
        const run = async (gi: number): Promise<void> => {
          if (gi === e.gens.length) {
            if (e.kind === 'dict') dict.set(await this.eval(e.elt, cs), await this.eval(e.value!, cs));
            else out.push(await this.eval(e.elt, cs));
            return;
          }
          const g = e.gens[gi];
          const items = await this.iterate(await this.eval(g.iter, gi === 0 ? scope : cs));
          for (const it of items) {
            this.hooks.loopGuard();
            await this.assign(g.target, it, cs);
            let ok = true;
            for (const cond of g.ifs) if (!truthy(await this.eval(cond, cs))) { ok = false; break; }
            if (ok) await run(gi + 1);
          }
        };
        await run(0);
        if (e.kind === 'dict') return dict;
        if (e.kind === 'set') return new PySet(out);
        return out;
      }
      case 'NamedExpr': {
        const v = await this.eval(e.value, scope);
        this.assignName(e.target, v, scope);
        return v;
      }
      case 'Yield': {
        const v = e.value ? await this.eval(e.value, scope) : null;
        let s: Scope | null = scope;
        while (s && !s.onYield) s = s.parent;
        if (!s?.onYield) throw this.err('SyntaxError', "'yield' outside function");
        return s.onYield(v);
      }
      case 'Await': return this.eval(e.value, scope);
    }
    throw this.err('SystemError', `unknown expression ${(e as { t: string }).t}`);
  }

  async evalElts(elts: Expr[], scope: Scope): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const x of elts) {
      if (x.t === 'Starred') out.push(...(await this.iterate(await this.eval(x.value, scope))));
      else out.push(await this.eval(x, scope));
    }
    return out;
  }
}

export const MISSING = Symbol('missing');

export class SliceVal {
  constructor(public lo: number | null, public hi: number | null, public step: number) {}
  /** Indices selected by the slice in a sequence of length `len` (Python semantics). */
  indices(len: number): number[] {
    const step = this.step;
    const out: number[] = [];
    if (step > 0) {
      const start = this.lo === null ? 0 : this.lo < 0 ? Math.max(0, len + this.lo) : Math.min(this.lo, len);
      const stop = this.hi === null ? len : this.hi < 0 ? Math.max(0, len + this.hi) : Math.min(this.hi, len);
      for (let i = start; i < stop; i += step) out.push(i);
    } else {
      const start = this.lo === null ? len - 1 : this.lo < 0 ? len + this.lo : Math.min(this.lo, len - 1);
      const stop = this.hi === null ? -1 : this.hi < 0 ? Math.max(-1, len + this.hi) : this.hi;
      for (let i = start; i > stop; i += step) out.push(i);
    }
    return out;
  }
}

/** Result of calling a generator function outside a fixture: values collected eagerly. */
export class PyGenerator implements PyHost {
  readonly pyType = 'generator';
  items: unknown[];
  pos = 0;
  constructor(items: unknown[]) { this.items = items; }
  drain(): unknown[] { const r = this.items.slice(this.pos); this.pos = this.items.length; return r; }
  pyIter() { return this.drain(); }
  pyGetAttr(): unknown { return undefined; }
  pyRepr() { return '<generator object>'; }
}

// ---------- helpers ----------

export function suggest(name: string, names: Iterable<string>): string {
  let best = '';
  let bestD = Infinity;
  for (const n of names) {
    if (n === name || n.startsWith('__')) continue;
    const d = lev(name.toLowerCase(), n.toLowerCase());
    if (d < bestD) { bestD = d; best = n; }
  }
  const limit = Math.max(1, Math.floor(name.length / 3));
  return best && bestD <= limit ? `. Did you mean: '${best}'?` : '';
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function allNames(scope: Scope): string[] {
  const out: string[] = [];
  for (let s: Scope | null = scope; s; s = s.parent) out.push(...s.vars.keys());
  out.push(...scope.module.mod.dict.keys());
  return out;
}

/** Common JS-isms in AI-generated "Python". */
const NAME_HINTS: Record<string, string> = {
  true: "Did you mean: 'True'?",
  false: "Did you mean: 'False'?",
  null: "Did you mean: 'None'?",
  undefined: "Did you mean: 'None'?",
  console: "Did you mean: 'print'?",
};

function percentFormat(fmt: string, args: unknown): string {
  const list = isTuple(args) ? [...args] : [args];
  let i = 0;
  return fmt.replace(/%([sdrf%]|\.\d+f)/g, (m, c: string) => {
    if (c === '%') return '%';
    const v = list[i++];
    if (c === 's') return str(v);
    if (c === 'r') return repr(v);
    if (c === 'd') return String(Math.trunc(Number(v)));
    if (c.endsWith('f')) return Number(v).toFixed(c === 'f' ? 6 : Number(c.slice(1, -1)));
    return m;
  });
}

// ---------- methods of built-in types ----------

type Impl = (self: never, args: unknown[], kwargs: Map<string, unknown>) => unknown;
let methodTable: Record<string, Record<string, Impl>> | null = null;

/** Names of methods per type, for "Did you mean" suggestions. */
export const TYPE_METHODS: Record<string, string[]> = {};

function typeMethods(ip: Interp): Record<string, Record<string, Impl>> {
  if (methodTable) return methodTable;
  const E = (n: string, m: string) => ip.err(n, m);
  const kw = (k: Map<string, unknown>, name: string, d: unknown) => (k.has(name) ? k.get(name) : d);
  const strT: Record<string, Impl> = {
    lower: (s: string) => s.toLowerCase(),
    upper: (s: string) => s.toUpperCase(),
    strip: (s: string, a) => (a[0] == null ? s.trim() : trimChars(s, String(a[0]), true, true)),
    lstrip: (s: string, a) => (a[0] == null ? s.replace(/^\s+/, '') : trimChars(s, String(a[0]), true, false)),
    rstrip: (s: string, a) => (a[0] == null ? s.replace(/\s+$/, '') : trimChars(s, String(a[0]), false, true)),
    split: (s: string, a, k) => {
      const sep = (a[0] ?? kw(k, 'sep', null)) as string | null;
      const max = Number(a[1] ?? kw(k, 'maxsplit', -1));
      if (sep === null) {
        const parts = s.trim().split(/\s+/).filter(Boolean);
        return max >= 0 && parts.length > max + 1 ? [...parts.slice(0, max), parts.slice(max).join(' ')] : parts;
      }
      if (sep === '') throw E('ValueError', 'empty separator');
      const parts = s.split(sep);
      return max >= 0 && parts.length > max + 1 ? [...parts.slice(0, max), parts.slice(max).join(sep)] : parts;
    },
    rsplit: (s: string, a) => (a[0] == null ? s.trim().split(/\s+/) : s.split(String(a[0]))),
    splitlines: (s: string) => s.split(/\r?\n/).filter((x, i, arr) => !(i === arr.length - 1 && x === '')),
    join: async (s: string, a) => {
      const items = await ip.iterate(a[0]);
      items.forEach((x) => { if (typeof x !== 'string') throw E('TypeError', `sequence item ${items.indexOf(x)}: expected str instance, ${typeName(x)} found`); });
      return items.join(s);
    },
    replace: (s: string, a) => (a[2] !== undefined ? replaceN(s, String(a[0]), String(a[1]), Number(a[2])) : s.split(String(a[0])).join(String(a[1]))),
    startswith: (s: string, a) => (isTuple(a[0]) ? (a[0] as string[]).some((p) => s.startsWith(p)) : s.startsWith(String(a[0]))),
    endswith: (s: string, a) => (isTuple(a[0]) ? (a[0] as string[]).some((p) => s.endsWith(p)) : s.endsWith(String(a[0]))),
    find: (s: string, a) => s.indexOf(String(a[0])),
    rfind: (s: string, a) => s.lastIndexOf(String(a[0])),
    index: (s: string, a) => { const i = s.indexOf(String(a[0])); if (i < 0) throw E('ValueError', 'substring not found'); return i; },
    count: (s: string, a) => (String(a[0]) === '' ? s.length + 1 : s.split(String(a[0])).length - 1),
    title: (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    capitalize: (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s),
    isdigit: (s: string) => /^\d+$/.test(s),
    isnumeric: (s: string) => /^\d+$/.test(s),
    isalpha: (s: string) => /^[\p{L}]+$/u.test(s),
    isalnum: (s: string) => /^[\p{L}\d]+$/u.test(s),
    isspace: (s: string) => /^\s+$/.test(s),
    isupper: (s: string) => s.toUpperCase() === s && s.toLowerCase() !== s,
    islower: (s: string) => s.toLowerCase() === s && s.toUpperCase() !== s,
    zfill: (s: string, a) => s.padStart(Number(a[0]), '0'),
    center: (s: string, a) => { const w = Number(a[0]); const f = String(a[1] ?? ' '); const l = Math.floor((w - s.length) / 2); return s.length >= w ? s : f.repeat(l) + s + f.repeat(w - s.length - l); },
    ljust: (s: string, a) => s.padEnd(Number(a[0]), String(a[1] ?? ' ')),
    rjust: (s: string, a) => s.padStart(Number(a[0]), String(a[1] ?? ' ')),
    removeprefix: (s: string, a) => (s.startsWith(String(a[0])) ? s.slice(String(a[0]).length) : s),
    removesuffix: (s: string, a) => (String(a[0]) && s.endsWith(String(a[0])) ? s.slice(0, -String(a[0]).length) : s),
    format: async (s: string, a, k) => {
      let auto = 0;
      const parts: string[] = [];
      let last = 0;
      const re = /\{\{|\}\}|\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) {
        parts.push(s.slice(last, m.index));
        last = re.lastIndex;
        if (m[0] === '{{') { parts.push('{'); continue; }
        if (m[0] === '}}') { parts.push('}'); continue; }
        const [field, spec = ''] = m[1].split(':');
        const v = field === '' ? a[auto++] : /^\d+$/.test(field) ? a[Number(field)] : k.get(field);
        if (v === undefined) throw field === '' || /^\d+$/.test(field) ? E('IndexError', 'Replacement index out of range for positional args tuple') : E('KeyError', `'${field}'`);
        parts.push(spec ? formatSpec(v, spec, ip) : await ip.pyStr(v));
      }
      parts.push(s.slice(last));
      return parts.join('');
    },
    encode: (s: string) => s,
  };
  const listT: Record<string, Impl> = {
    append: (l: unknown[], a) => { l.push(a[0]); return null; },
    extend: async (l: unknown[], a) => { l.push(...(await ip.iterate(a[0]))); return null; },
    insert: (l: unknown[], a) => { l.splice(Number(a[0]) < 0 ? Math.max(0, l.length + Number(a[0])) : Number(a[0]), 0, a[1]); return null; },
    pop: (l: unknown[], a) => {
      if (!l.length) throw E('IndexError', 'pop from empty list');
      const i = a.length ? ip.index(l, a[0]) : l.length - 1;
      if (i < 0 || i >= l.length) throw E('IndexError', 'pop index out of range');
      return l.splice(i, 1)[0];
    },
    remove: (l: unknown[], a) => { const i = l.findIndex((x) => pyEq(x, a[0])); if (i < 0) throw E('ValueError', 'list.remove(x): x not in list'); l.splice(i, 1); return null; },
    index: (l: unknown[], a) => { const i = l.findIndex((x) => pyEq(x, a[0])); if (i < 0) throw E('ValueError', `${repr(a[0])} is not in list`); return i; },
    count: (l: unknown[], a) => l.filter((x) => pyEq(x, a[0])).length,
    sort: async (l: unknown[], _a, k) => { const r = await sortValues(ip, l, k.get('key') ?? null, truthy(k.get('reverse') ?? false)); l.splice(0, l.length, ...r); return null; },
    reverse: (l: unknown[]) => { l.reverse(); return null; },
    copy: (l: unknown[]) => [...l],
    clear: (l: unknown[]) => { l.length = 0; return null; },
  };
  const tupleT: Record<string, Impl> = {
    index: listT.index,
    count: listT.count,
  };
  const dictT: Record<string, Impl> = {
    get: (d: PyDict, a) => (d.has(a[0]) ? d.get(a[0]) : (a[1] ?? null)),
    keys: (d: PyDict) => d.keys(),
    values: (d: PyDict) => d.values(),
    items: (d: PyDict) => d.items().map(([k, v]) => tuple([k, v])),
    update: (d: PyDict, a, k) => { if (a[0] instanceof PyDict) for (const [x, y] of a[0].items()) d.set(x, y); for (const [x, y] of k) d.set(x, y); return null; },
    pop: (d: PyDict, a) => { if (d.has(a[0])) { const v = d.get(a[0]); d.delete(a[0]); return v; } if (a.length > 1) return a[1]; throw E('KeyError', repr(a[0])); },
    setdefault: (d: PyDict, a) => { if (!d.has(a[0])) d.set(a[0], a[1] ?? null); return d.get(a[0]); },
    copy: (d: PyDict) => PyDict.from(d.items()),
    clear: (d: PyDict) => { d.map.clear(); return null; },
  };
  const setT: Record<string, Impl> = {
    add: (s: PySet, a) => { s.add(a[0]); return null; },
    remove: (s: PySet, a) => { if (!s.delete(a[0])) throw E('KeyError', repr(a[0])); return null; },
    discard: (s: PySet, a) => { s.delete(a[0]); return null; },
    union: async (s: PySet, a) => new PySet([...s.values(), ...(await ip.iterate(a[0]))]),
    intersection: async (s: PySet, a) => { const o = new PySet(await ip.iterate(a[0])); return new PySet(s.values().filter((x) => o.has(x))); },
    difference: async (s: PySet, a) => { const o = new PySet(await ip.iterate(a[0])); return new PySet(s.values().filter((x) => !o.has(x))); },
    issubset: async (s: PySet, a) => { const o = new PySet(await ip.iterate(a[0])); return s.values().every((x) => o.has(x)); },
  };
  const intT: Record<string, Impl> = {
    is_integer: (n: number) => Number.isInteger(n),
  };
  methodTable = { str: strT, list: listT, tuple: tupleT, dict: dictT, set: setT, int: intT, float: intT };
  for (const [k, v] of Object.entries(methodTable)) TYPE_METHODS[k] = Object.keys(v);
  TYPE_METHODS.NoneType = [];
  return methodTable;
}

function trimChars(s: string, chars: string, left: boolean, right: boolean): string {
  let a = 0;
  let b = s.length;
  if (left) while (a < b && chars.includes(s[a])) a++;
  if (right) while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function replaceN(s: string, a: string, b: string, n: number): string {
  let out = s;
  let i = 0;
  let pos = 0;
  while (i < n) {
    const k = out.indexOf(a, pos);
    if (k < 0) break;
    out = out.slice(0, k) + b + out.slice(k + a.length);
    pos = k + b.length;
    i++;
  }
  return out;
}

export async function sortValues(ip: Interp, items: unknown[], key: unknown, reverse: boolean): Promise<unknown[]> {
  const keyed: Array<[unknown, unknown]> = [];
  for (const x of items) keyed.push([key && key !== null ? await ip.call(key, [x], new Map()) : x, x]);
  keyed.sort((p, q) => ip.cmp(p[0], q[0]));
  if (reverse) keyed.reverse();
  return keyed.map((p) => p[1]);
}

// re-export for other modules
export { fmtFloat, hashKey };
declare module './values' {
  interface PyException {
    withArgs(args: unknown[]): PyException;
  }
}
PyException.prototype.withArgs = function (this: PyException, args: unknown[]) {
  this.exc.dict.set('args', args);
  return this;
};
