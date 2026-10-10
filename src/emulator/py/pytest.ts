// The `pytest` module: fixtures, marks, parametrize, raises, approx, skip/fail.
import type { Interp } from './interp';
import {
  PyBuiltin, PyClass, PyDict, PyException, PyFunction, PyInstance, PyModule, PyPattern, isHost, isTuple, pyEq, repr,
  reprStr, tuple, typeName, type PyHost,
} from './values';

export interface Mark { name: string; args: unknown[]; kwargs: Map<string, unknown> }
export interface FixtureInfo { scope: string; autouse: boolean; params: unknown[] | null; ids: unknown; name: string | null }

export class ParamSet implements PyHost {
  readonly pyType = 'ParameterSet';
  constructor(public values: unknown[], public id: string | null, public marks: Mark[]) {}
  pyGetAttr(name: string): unknown {
    if (name === 'values') return tuple(this.values);
    if (name === 'id') return this.id;
    return undefined;
  }
  pyRepr() { return `ParameterSet(values=${repr(tuple(this.values))}, marks=(), id=${this.id === null ? 'None' : reprStr(this.id)})`; }
}

/** Marks are stored here (functions keep them in attrs, classes in this map). */
export const classMarks = new WeakMap<PyClass, Mark[]>();

export function marksOf(v: unknown): Mark[] {
  if (v instanceof PyFunction) return (v.attrs.get('__marks__') as Mark[] | undefined) ?? [];
  if (v instanceof PyClass) return classMarks.get(v) ?? [];
  return [];
}

function applyMark(ip: () => Interp, target: unknown, mark: Mark): unknown {
  if (target instanceof PyFunction) {
    const list = (target.attrs.get('__marks__') as Mark[] | undefined) ?? [];
    target.attrs.set('__marks__', [...list, mark]);
    return target;
  }
  if (target instanceof PyClass) {
    classMarks.set(target, [...(classMarks.get(target) ?? []), mark]);
    return target;
  }
  throw ip().err('TypeError', `@pytest.mark.${mark.name} can only decorate a function or a class, not ${typeName(target)}`);
}

class MarkDecorator implements PyHost {
  readonly pyType = 'MarkDecorator';
  constructor(private ip: () => Interp, public mark: Mark) {}
  pyGetAttr(name: string): unknown {
    if (name === 'name') return this.mark.name;
    if (name === 'args') return tuple(this.mark.args);
    if (name === 'with_args') return new PyBuiltin('with_args', (a, k) => new MarkDecorator(this.ip, { name: this.mark.name, args: [...this.mark.args, ...a], kwargs: new Map([...this.mark.kwargs, ...k]) }));
    return undefined;
  }
  /** Called as a decorator (one function/class) or with arguments (returns a new decorator). */
  pyCall(args: unknown[], kwargs: Map<string, unknown>): unknown {
    if (args.length === 1 && !kwargs.size && (args[0] instanceof PyFunction || args[0] instanceof PyClass)) {
      return applyMark(this.ip, args[0], this.mark);
    }
    return new MarkDecorator(this.ip, { name: this.mark.name, args: [...this.mark.args, ...args], kwargs: new Map([...this.mark.kwargs, ...kwargs]) });
  }
  pyRepr() { return `<MarkDecorator ${reprStr(this.mark.name)}>`; }
}

class RaisesContext implements PyHost {
  readonly pyType = 'RaisesContext';
  value: PyInstance | null = null;
  constructor(private ip: () => Interp, private expected: PyClass[], private match: unknown) {}
  pyGetAttr(name: string): unknown {
    if (name === 'value') return this.value;
    if (name === 'type') return this.value?.cls ?? null;
    return undefined;
  }
  pyEnter() { return this; }
  async pyExit(exc: PyException | null): Promise<boolean> {
    const names = this.expected.map((c) => `<class '${c.name}'>`).join(' or ');
    if (!exc) throw failed(this.ip, `DID NOT RAISE ${names}`);
    if (!this.expected.some((c) => exc.cls.isSubclassOf(c))) return false;
    if (this.match !== null && this.match !== undefined) {
      const re = this.match instanceof PyPattern ? this.match.re : new RegExp(String(this.match));
      const msg = exc.message;
      if (!re.test(msg)) throw failed(this.ip, `Regex pattern did not match.\n Regex: ${reprStr(String(this.match instanceof PyPattern ? this.match.pattern : this.match))}\n Input: ${reprStr(msg)}`);
    }
    this.value = exc.exc;
    return true;
  }
}

class Approx implements PyHost {
  readonly pyType = 'ApproxScalar';
  constructor(public expected: unknown, public rel: number, public abs: number) {}
  pyGetAttr(): unknown { return undefined; }
  close(a: number, b: number): boolean {
    return Math.abs(a - b) <= Math.max(this.rel * Math.abs(b), this.abs);
  }
  pyEq(other: unknown): boolean {
    const e = this.expected;
    if (typeof e === 'number' && typeof other === 'number') return this.close(other, e);
    if (Array.isArray(e) && Array.isArray(other)) return e.length === other.length && e.every((x, i) => (typeof x === 'number' && typeof other[i] === 'number' ? this.close(other[i] as number, x) : pyEq(x, other[i])));
    return pyEq(e, other);
  }
  pyRepr() {
    const e = this.expected;
    if (typeof e === 'number') return `${e} ± ${Math.max(this.rel * Math.abs(e), this.abs).toExponential(1).replace(/e([+-])(\d)$/, 'e$10$2')}`;
    return `approx(${repr(e)})`;
  }
}

function failed(ip: () => Interp, msg: string): PyException {
  const e = ip().err('Failed', msg);
  e.emu = { code: 'pytest-failed', message: `Failed: ${msg}`, data: { message: msg } };
  return e;
}

export function makePytestModule(ip: () => Interp): () => PyModule {
  return () => {
    const m = new PyModule('pytest');
    const fixtureDeco = (k: Map<string, unknown>) => (f: unknown): unknown => {
      if (!(f instanceof PyFunction)) throw ip().err('TypeError', '@pytest.fixture can only decorate a function');
      const params = k.get('params');
      const info: FixtureInfo = {
        scope: String(k.get('scope') ?? 'function'),
        autouse: !!k.get('autouse'),
        params: params === undefined || params === null ? null : Array.isArray(params) ? [...params] : null,
        ids: k.get('ids') ?? null,
        name: (k.get('name') as string | undefined) ?? null,
      };
      if (!['function', 'class', 'module', 'package', 'session'].includes(info.scope)) throw ip().err('ValueError', `fixture '${f.name}' has an unsupported scope value '${info.scope}'`);
      f.attrs.set('__fixture__', info);
      return f;
    };
    m.dict.set('fixture', new PyBuiltin('fixture', (a, k) => {
      if (a[0] instanceof PyFunction) return fixtureDeco(k)(a[0]);
      return new PyBuiltin('fixture', (b) => fixtureDeco(k)(b[0]));
    }));
    const markHost: PyHost = {
      pyType: 'MarkGenerator',
      pyGetAttr: (name: string) => (name.startsWith('_') ? undefined : new MarkDecorator(ip, { name, args: [], kwargs: new Map() })),
    };
    m.dict.set('mark', markHost);
    m.dict.set('param', new PyBuiltin('param', (a, k) => {
      const marks = k.get('marks');
      const list = marks instanceof MarkDecorator ? [marks.mark] : Array.isArray(marks) ? (marks as unknown[]).filter((x): x is MarkDecorator => x instanceof MarkDecorator).map((x) => x.mark) : [];
      return new ParamSet(a, (k.get('id') as string | undefined) ?? null, list);
    }));
    const outcome = (cls: string, code: string) => new PyBuiltin(cls.toLowerCase(), (a, k) => {
      const reason = String(a[0] ?? k.get('reason') ?? k.get('msg') ?? '');
      const e = ip().err(cls === 'Skip' ? 'Skipped' : cls === 'Xfail' ? 'XFailed' : 'Failed', reason);
      e.emu = { code, message: reason, data: { reason } };
      throw e;
    });
    m.dict.set('skip', outcome('Skip', 'skipped'));
    m.dict.set('fail', outcome('Fail', 'pytest-failed'));
    m.dict.set('xfail', outcome('Xfail', 'xfailed'));
    m.dict.set('raises', new PyBuiltin('raises', (a, k) => {
      const exp = a[0];
      const classes = isTuple(exp) ? (exp as unknown[]) : [exp];
      if (!classes.every((c) => c instanceof PyClass)) throw ip().err('TypeError', `expected exception must be a BaseException type, not ${typeName(exp)}`);
      if (a.length > 1) throw ip().err('TypeError', 'pytest.raises(): use it as a context manager — with pytest.raises(...):');
      return new RaisesContext(ip, classes as PyClass[], k.get('match') ?? null);
    }));
    m.dict.set('approx', new PyBuiltin('approx', (a, k) => new Approx(a[0], Number(k.get('rel') ?? 1e-6), Number(k.get('abs') ?? 1e-12))));
    m.dict.set('FixtureRequest', Object.assign(new PyClass('FixtureRequest', [], '_pytest.fixtures'), { check: (v: unknown) => isHost(v) && v.pyType === 'SubRequest' }));
    m.dict.set('MonkeyPatch', new PyClass('MonkeyPatch', [], '_pytest.monkeypatch'));
    return m;
  };
}

export function isMarkDecorator(v: unknown): v is MarkDecorator {
  return v instanceof MarkDecorator;
}

/** pytest's id for one parameter value. */
export function paramId(v: unknown, argname: string, index: number): string {
  if (typeof v === 'string') return v.replace(/[^\x20-\x7e]/g, (c) => (c.charCodeAt(0) > 0xff ? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}` : `\\x${c.charCodeAt(0).toString(16)}`));
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return repr(v);
  if (v instanceof PyPattern) return v.pattern;
  return `${argname}${index}`;
}

export function dictFrom(entries: Array<[string, unknown]>): PyDict { return PyDict.from(entries); }
