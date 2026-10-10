// Static analysis of Python test code: lint notes for the report and rules for grading tasks.
import type { Expr, Module, Stmt } from './py/ast';
import { srcOf } from './py/ast';
import { parseModule } from './py/parser';
import type { Comment } from './py/lexer';
import type { StaticFinding } from './types';

/** Playwright methods that do something — writing them without () does nothing. */
const ACTIONS = new Set([
  'goto', 'click', 'dblclick', 'fill', 'clear', 'press', 'press_sequentially', 'type', 'check', 'uncheck', 'set_checked',
  'select_option', 'hover', 'focus', 'reload', 'go_back', 'wait_for_url', 'wait_for_timeout', 'wait_for_load_state', 'wait_for',
  'text_content', 'inner_text', 'input_value', 'get_attribute', 'is_visible', 'is_hidden', 'is_enabled', 'is_disabled', 'is_checked',
  'count', 'all_text_contents', 'all_inner_texts', 'title', 'scroll_into_view_if_needed', 'json', 'text',
]);
/** Instant checks — no retry. Asserting on them makes a test flaky. */
const QUERY_STATE = new Set(['is_visible', 'is_hidden', 'is_enabled', 'is_disabled', 'is_checked', 'is_editable', 'count', 'text_content', 'inner_text', 'input_value', 'get_attribute', 'all_text_contents', 'all_inner_texts']);
const LOCATOR_FACTORIES = new Set(['get_by_role', 'get_by_text', 'get_by_label', 'get_by_placeholder', 'get_by_test_id', 'get_by_alt_text', 'get_by_title', 'locator', 'nth', 'filter', 'and_', 'or_']);
export const WEB_FIRST = new Set([
  'to_be_visible', 'to_be_hidden', 'to_be_enabled', 'to_be_disabled', 'to_be_checked', 'to_be_editable', 'to_be_empty', 'to_be_focused',
  'to_be_attached', 'to_be_in_viewport', 'to_have_text', 'to_contain_text', 'to_have_value', 'to_have_values', 'to_have_attribute',
  'to_have_class', 'to_contain_class', 'to_have_count', 'to_have_id', 'to_have_url', 'to_have_title', 'to_be_ok',
]);

export interface Analysis {
  findings: StaticFinding[];
  /** expect(...).to_*() calls + assert statements */
  expectCount: number;
  testCount: number;
  code: string;
  codeNoComments: string;
  module: Module | null;
}

/** expect(x).to_be_visible / expect(x).not_to_have_text … → the matcher name, else null */
function matcherOf(e: Expr): string | null {
  if (e.t !== 'Attribute') return null;
  if (!/^(not_)?to_/.test(e.attr)) return null;
  const v = e.value;
  if (v.t === 'Call' && v.func.t === 'Name' && v.func.id === 'expect') return e.attr;
  return null;
}

function isLocatorExpr(e: Expr): boolean {
  if (e.t === 'Call' && e.func.t === 'Attribute') return LOCATOR_FACTORIES.has(e.func.attr);
  if (e.t === 'Attribute' && (e.attr === 'first' || e.attr === 'last')) return isLocatorExpr(e.value);
  return false;
}

function fragileSelector(sel: string): boolean {
  const s = sel.trim();
  return !/^(\[data-testid=|data-testid=|internal:testid=)/.test(s);
}

/** Visits every expression inside a statement list (not into nested defs unless asked). */
function walkStmts(body: Stmt[], visit: { stmt?: (s: Stmt) => void; expr?: (e: Expr, stmt: Stmt) => void }, intoDefs = true) {
  const ex = (e: Expr | null | undefined, st: Stmt) => { if (e) walkExpr(e, (x) => visit.expr?.(x, st)); };
  for (const s of body) {
    visit.stmt?.(s);
    switch (s.t) {
      case 'Expr': ex(s.value, s); break;
      case 'Assign': s.targets.forEach((t) => ex(t, s)); ex(s.value, s); break;
      case 'AugAssign': ex(s.target, s); ex(s.value, s); break;
      case 'AnnAssign': ex(s.value, s); break;
      case 'Return': ex(s.value, s); break;
      case 'Raise': ex(s.exc, s); break;
      case 'Assert': ex(s.test, s); ex(s.msg, s); break;
      case 'If': ex(s.test, s); walkStmts(s.body, visit, intoDefs); walkStmts(s.orelse, visit, intoDefs); break;
      case 'While': ex(s.test, s); walkStmts(s.body, visit, intoDefs); walkStmts(s.orelse, visit, intoDefs); break;
      case 'For': ex(s.iter, s); walkStmts(s.body, visit, intoDefs); walkStmts(s.orelse, visit, intoDefs); break;
      case 'With': s.items.forEach((it) => ex(it.ctx, s)); walkStmts(s.body, visit, intoDefs); break;
      case 'Try': walkStmts(s.body, visit, intoDefs); s.handlers.forEach((h) => walkStmts(h.body, visit, intoDefs)); walkStmts(s.orelse, visit, intoDefs); walkStmts(s.finalbody, visit, intoDefs); break;
      case 'FunctionDef': s.decorators.forEach((d) => ex(d, s)); if (intoDefs) walkStmts(s.body, visit, intoDefs); break;
      case 'ClassDef': s.decorators.forEach((d) => ex(d, s)); if (intoDefs) walkStmts(s.body, visit, intoDefs); break;
    }
  }
}

function walkExpr(e: Expr, f: (e: Expr) => void) {
  f(e);
  switch (e.t) {
    case 'FString': for (const p of e.parts) if (typeof p !== 'string') walkExpr(p.expr, f); break;
    case 'List': case 'Tuple': case 'Set': e.elts.forEach((x) => walkExpr(x, f)); break;
    case 'Dict': e.keys.forEach((k) => k && walkExpr(k, f)); e.values.forEach((v) => walkExpr(v, f)); break;
    case 'Starred': walkExpr(e.value, f); break;
    case 'Attribute': walkExpr(e.value, f); break;
    case 'Subscript': walkExpr(e.value, f); walkExpr(e.slice, f); break;
    case 'Slice': [e.lower, e.upper, e.step].forEach((x) => x && walkExpr(x, f)); break;
    case 'Call': walkExpr(e.func, f); e.args.forEach((a) => walkExpr(a, f)); e.keywords.forEach((k) => walkExpr(k.value, f)); break;
    case 'BinOp': walkExpr(e.left, f); walkExpr(e.right, f); break;
    case 'UnaryOp': walkExpr(e.operand, f); break;
    case 'BoolOp': e.values.forEach((v) => walkExpr(v, f)); break;
    case 'Compare': walkExpr(e.left, f); e.comparators.forEach((c) => walkExpr(c, f)); break;
    case 'IfExp': walkExpr(e.test, f); walkExpr(e.body, f); walkExpr(e.orelse, f); break;
    case 'Lambda': walkExpr(e.body, f); break;
    case 'Comp': walkExpr(e.elt, f); if (e.value) walkExpr(e.value, f); e.gens.forEach((g) => { walkExpr(g.iter, f); g.ifs.forEach((x) => walkExpr(x, f)); }); break;
    case 'NamedExpr': walkExpr(e.value, f); break;
    case 'Yield': if (e.value) walkExpr(e.value, f); break;
    case 'Await': walkExpr(e.value, f); break;
  }
}

/** Test functions: module-level def test* and methods test* inside class Test*. */
function testFunctions(mod: Module): Array<Extract<Stmt, { t: 'FunctionDef' }>> {
  const out: Array<Extract<Stmt, { t: 'FunctionDef' }>> = [];
  const isFixture = (s: Extract<Stmt, { t: 'FunctionDef' }>) => s.decorators.some((d) => /fixture/.test(srcOf(mod, d)));
  for (const s of mod.body) {
    if (s.t === 'FunctionDef' && s.name.startsWith('test') && !isFixture(s)) out.push(s);
    if (s.t === 'ClassDef' && s.name.startsWith('Test')) {
      for (const m of s.body) if (m.t === 'FunctionDef' && m.name.startsWith('test') && !isFixture(m)) out.push(m);
    }
  }
  return out;
}

export function analyze(src: string): Analysis {
  const comments: Comment[] = [];
  let mod: Module;
  try {
    mod = parseModule(src, 'test_example.py', comments);
  } catch {
    return { findings: [], expectCount: 0, testCount: 0, code: src, codeNoComments: src, module: null };
  }
  const findings: StaticFinding[] = [];
  let expectCount = 0;
  const tests = testFunctions(mod);
  const timeImported = /\bfrom\s+time\s+import\s+[^\n]*\bsleep\b/.test(src);

  walkStmts(mod.body, {
    stmt: (s) => {
      if (s.t === 'Assert') {
        expectCount++;
        const test = s.test;
        if (isLocatorExpr(test)) findings.push({ rule: 'always-true', line: s.line, data: { expr: srcOf(mod, test) } });
        else if (test.t === 'Attribute' && (ACTIONS.has(test.attr) || QUERY_STATE.has(test.attr))) findings.push({ rule: 'not-called', line: s.line, data: { call: `${test.attr}()` } });
        else {
          let weak = '';
          walkExpr(test, (x) => { if (!weak && x.t === 'Call' && x.func.t === 'Attribute' && QUERY_STATE.has(x.func.attr)) weak = x.func.attr; });
          if (weak) findings.push({ rule: 'weak-assertion', line: s.line, data: { method: weak } });
        }
      }
      if (s.t === 'Expr') {
        const v = s.value;
        // page.reload / expect(x).to_be_visible — a method mentioned but never called
        if (v.t === 'Attribute' && (ACTIONS.has(v.attr) || matcherOf(v))) findings.push({ rule: 'not-called', line: s.line, data: { call: `${v.attr}()` } });
        if (v.t === 'Call' && v.func.t === 'Name' && v.func.id === 'expect') findings.push({ rule: 'no-matcher', line: s.line, data: {} });
      }
    },
    expr: (e, st) => {
      if (e.t !== 'Call') return;
      const f = e.func;
      const matcher = matcherOf(f);
      if (matcher) { expectCount++; return; }
      if (f.t === 'Attribute') {
        if (f.attr === 'wait_for_timeout' || (f.attr === 'sleep' && f.value.t === 'Name' && f.value.id === 'time')) findings.push({ rule: 'hard-wait', line: st.line, data: {} });
        const first = e.args[0];
        if (f.attr === 'locator' && first?.t === 'Const' && typeof first.value === 'string' && fragileSelector(first.value)) {
          findings.push({ rule: 'fragile-locator', line: e.line, data: { selector: first.value } });
        }
        if (['click', 'fill', 'check', 'type', 'text_content', 'inner_text', 'is_visible', 'hover', 'dblclick', 'select_option'].includes(f.attr) && f.value.t === 'Name' && f.value.id === 'page' && first?.t === 'Const' && typeof first.value === 'string') {
          findings.push({ rule: 'fragile-locator', line: e.line, data: { selector: first.value } });
        }
      }
      if (f.t === 'Name' && f.id === 'sleep' && timeImported) findings.push({ rule: 'hard-wait', line: st.line, data: {} });
    },
  });

  for (const t of tests) {
    let n = 0;
    walkStmts(t.body, {
      stmt: (s) => { if (s.t === 'Assert') n++; },
      expr: (e) => { if (e.t === 'Call' && matcherOf(e.func)) n++; },
    });
    if (n === 0) findings.push({ rule: 'no-assertion', line: t.line, data: { title: t.name } });
  }

  let noComments = src;
  for (const c of [...comments].sort((a, b) => b.start - a.start)) noComments = noComments.slice(0, c.start) + noComments.slice(c.end);
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const seen = new Set<string>();
  const unique = findings.filter((f) => { const k = `${f.rule}:${f.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { findings: unique, expectCount, testCount: tests.length, code: src, codeNoComments: noComments, module: mod };
}

export type RuleSpec =
  | 'hasAssertion' | 'noHardWait' | 'noFragile' | 'callsMethods'
  | { rule: 'uses' | 'notUses' | 'regex' | 'notRegex' | 'minExpects'; value: string | number; message?: { en: string; ru: string } };

export interface RuleFailure {
  rule: string;
  value?: string | number;
  line?: number;
  message?: { en: string; ru: string };
}

export function checkRules(rules: RuleSpec[] | undefined, a: Analysis): RuleFailure[] {
  const out: RuleFailure[] = [];
  for (const r of rules || []) {
    if (r === 'hasAssertion') {
      const f = a.findings.find((x) => x.rule === 'no-assertion');
      if (f || a.expectCount === 0) out.push({ rule: 'hasAssertion', line: f?.line });
    } else if (r === 'noHardWait') {
      const f = a.findings.find((x) => x.rule === 'hard-wait');
      if (f) out.push({ rule: 'noHardWait', line: f.line });
    } else if (r === 'noFragile') {
      const f = a.findings.find((x) => x.rule === 'fragile-locator');
      if (f) out.push({ rule: 'noFragile', line: f.line, value: String(f.data?.selector ?? '') });
    } else if (r === 'callsMethods') {
      const f = a.findings.find((x) => x.rule === 'not-called');
      if (f) out.push({ rule: 'callsMethods', line: f.line, value: String(f.data?.call ?? '') });
    } else if (typeof r === 'object') {
      const v = String(r.value);
      if (r.rule === 'uses' && !a.codeNoComments.includes(v)) out.push({ rule: 'uses', value: v, message: r.message });
      if (r.rule === 'notUses' && a.codeNoComments.includes(v)) out.push({ rule: 'notUses', value: v, message: r.message });
      if (r.rule === 'regex' && !new RegExp(v).test(a.codeNoComments)) out.push({ rule: 'regex', value: v, message: r.message });
      if (r.rule === 'notRegex' && new RegExp(v).test(a.codeNoComments)) out.push({ rule: 'notRegex', value: v, message: r.message });
      if (r.rule === 'minExpects' && a.expectCount < Number(r.value)) out.push({ rule: 'minExpects', value: Number(r.value), message: r.message });
    }
  }
  return out;
}
