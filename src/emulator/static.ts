// Static analysis of test code: lint notes for the report and rules for grading tasks.
import * as acorn from 'acorn';
import { ancestor as walkAncestor } from 'acorn-walk';
import type { StaticFinding } from './types';
import type { AstNode } from './transform';

const ACTIONS = new Set([
  'goto', 'click', 'dblclick', 'fill', 'clear', 'press', 'pressSequentially', 'type', 'check', 'uncheck', 'setChecked',
  'selectOption', 'hover', 'focus', 'reload', 'goBack', 'waitForURL', 'waitForTimeout', 'waitForLoadState', 'textContent',
  'innerText', 'inputValue', 'getAttribute', 'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'count',
  'allTextContents', 'allInnerTexts', 'waitFor', 'title', 'scrollIntoViewIfNeeded',
]);
const REQUEST_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'fetch']);
export const WEB_FIRST = new Set([
  'toBeVisible', 'toBeHidden', 'toBeEnabled', 'toBeDisabled', 'toBeChecked', 'toBeEditable', 'toBeEmpty', 'toBeFocused',
  'toBeAttached', 'toBeInViewport', 'toHaveText', 'toContainText', 'toHaveValue', 'toHaveValues', 'toHaveAttribute',
  'toHaveClass', 'toContainClass', 'toHaveCount', 'toHaveId', 'toHaveURL', 'toHaveTitle',
]);
const QUERY_STATE = new Set(['isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked', 'isEditable', 'count']);
const LOCATOR_FACTORIES = new Set(['getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByAltText', 'getByTitle', 'locator', 'first', 'last', 'nth', 'filter']);

export interface Analysis {
  findings: StaticFinding[];
  expectCount: number;
  testCount: number;
  code: string;
  codeNoComments: string;
}

/** Is `node` an expect(...) call or expect(...).not / expect.soft(...) chain? */
function expectRoot(node: AstNode): AstNode | null {
  let n: AstNode | null = node;
  while (n) {
    if (n.type === 'CallExpression') {
      const c = n.callee as AstNode;
      if (c.type === 'Identifier' && c.name === 'expect') return n;
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'expect' && ['soft', 'poll'].includes(c.property.name)) return n;
      return null;
    }
    if (n.type === 'MemberExpression') { n = n.object as AstNode; continue; }
    return null;
  }
  return null;
}

function calleeName(call: AstNode): string | null {
  const c = call.callee as AstNode;
  if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
  if (c.type === 'Identifier') return c.name;
  return null;
}

function isFloating(ancestors: AstNode[]): boolean {
  // ancestors: [..., parent, node]
  const parent = ancestors[ancestors.length - 2];
  if (!parent) return false;
  if (parent.type === 'ExpressionStatement') return true;
  if (parent.type === 'SequenceExpression') return ancestors[ancestors.length - 3]?.type === 'ExpressionStatement';
  return false;
}

function isLocatorExpr(n: AstNode): boolean {
  if (n.type !== 'CallExpression') return false;
  const name = calleeName(n);
  return !!name && LOCATOR_FACTORIES.has(name);
}

function fragileSelector(sel: string): boolean {
  const s = sel.trim();
  if (/^\[data-testid=/.test(s)) return false;
  return true;
}

export function analyze(src: string, ast: acorn.Program): Analysis {
  const findings: StaticFinding[] = [];
  let expectCount = 0;
  let testCount = 0;
  const testBodies: { node: AstNode; line: number; title: string; expects: number }[] = [];

  // pass 1: test('title', fn) bodies (acorn-walk visits children before parents)
  walkAncestor(ast, {
    CallExpression(node) {
      const n = node as AstNode;
      const c = n.callee as AstNode;
      if ((c.type === 'Identifier' && c.name === 'test') || (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'test' && ['only', 'skip', 'fixme', 'fail'].includes(c.property.name))) {
        const fn = (n.arguments as AstNode[]).find((a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression');
        if (fn) {
          testCount++;
          const t = (n.arguments as AstNode[])[0];
          testBodies.push({ node: fn, line: n.loc?.start.line ?? 0, title: t?.type === 'Literal' ? String(t.value) : t?.type === 'TemplateLiteral' ? t.quasis.map((q: AstNode) => q.value.cooked).join('…') : '', expects: 0 });
        }
      }
    },
  });

  // pass 2: everything else
  walkAncestor(ast, {
    CallExpression(node, _state, ancestors) {
      const n = node as AstNode;
      const anc = ancestors as AstNode[];
      const name = calleeName(n);
      const line = n.loc?.start.line;
      const c = n.callee as AstNode;

      // matcher call on expect(...)
      if (c.type === 'MemberExpression' && name && /^to[A-Z]/.test(name)) {
        const root = expectRoot(c.object as AstNode);
        if (root) {
          expectCount++;
          for (const tb of testBodies) if (anc.includes(tb.node)) tb.expects++;
          if (WEB_FIRST.has(name) && isFloating(anc)) findings.push({ rule: 'missing-await', line, data: { call: `expect(…).${name}()` } });
          if (['toBeTruthy', 'toBeFalsy', 'toBeDefined'].includes(name)) {
            const arg = (root.arguments as AstNode[])[0];
            if (arg) {
              const inner = arg.type === 'AwaitExpression' ? (arg.argument as AstNode) : arg;
              if (isLocatorExpr(arg) || (inner.type === 'CallExpression' && QUERY_STATE.has(calleeName(inner) || ''))) {
                findings.push({ rule: 'weak-assertion', line, data: { matcher: name } });
              }
            }
          }
        }
        return;
      }

      if (c.type === 'MemberExpression' && name) {
        const obj = c.object as AstNode;
        const isRequest = REQUEST_METHODS.has(name) && ((obj.type === 'Identifier' && obj.name === 'request') || (obj.type === 'MemberExpression' && obj.property?.name === 'request'));
        const isStep = name === 'step' && obj.type === 'Identifier' && obj.name === 'test';
        const isAction = ACTIONS.has(name) && !(obj.type === 'Identifier' && obj.name === 'console');
        if ((isAction || isRequest || isStep) && isFloating(anc)) {
          findings.push({ rule: 'missing-await', line, data: { call: `${name}()` } });
        }
        if (name === 'waitForTimeout') findings.push({ rule: 'hard-wait', line, data: {} });
        if ((name === 'locator' || name === '$' || name === '$$') && (n.arguments as AstNode[])[0]?.type === 'Literal') {
          const sel = String((n.arguments as AstNode[])[0].value);
          if (fragileSelector(sel)) findings.push({ rule: 'fragile-locator', line, data: { selector: sel } });
        }
        if (['click', 'fill', 'check', 'type'].includes(name) && obj.type === 'Identifier' && obj.name === 'page' && (n.arguments as AstNode[])[0]?.type === 'Literal') {
          findings.push({ rule: 'fragile-locator', line, data: { selector: String((n.arguments as AstNode[])[0].value) } });
        }
      }
    },
  });

  for (const tb of testBodies) {
    if (tb.expects === 0) findings.push({ rule: 'no-assertion', line: tb.line, data: { title: tb.title } });
  }

  const comments: { start: number; end: number }[] = [];
  try {
    acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', onComment: (_b, _t, start, end) => comments.push({ start, end }) });
  } catch { /* already parsed once */ }
  let noComments = src;
  for (const c of comments.sort((a, b) => b.start - a.start)) noComments = noComments.slice(0, c.start) + noComments.slice(c.end);

  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { findings, expectCount, testCount, code: src, codeNoComments: noComments };
}

export type RuleSpec =
  | 'hasAssertion' | 'noHardWait' | 'noFragile' | 'awaitsActions'
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
    } else if (r === 'awaitsActions') {
      const f = a.findings.find((x) => x.rule === 'missing-await');
      if (f) out.push({ rule: 'awaitsActions', line: f.line, value: String(f.data?.call ?? '') });
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
