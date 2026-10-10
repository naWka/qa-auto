// Turns a spec/module source into code we can evaluate, keeping line numbers intact:
// imports → __import() calls, exports → __exports assignments, loops get an infinite-loop guard.
import * as acorn from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import { EmuError } from './errors';

export type AstNode = acorn.Node & Record<string, any>;

export function parse(src: string, file: string): acorn.Program {
  try {
    return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (e) {
    const err = e as SyntaxError & { loc?: { line: number; column: number } };
    const message = err.message.replace(/\s*\(\d+:\d+\)$/, '');
    const line = err.loc?.line;
    let code = 'syntax';
    if (/await/.test(message) && /async/.test(message)) code = 'async-missing';
    else if (/Unterminated string/.test(message)) code = 'syntax-string';
    else if (/Unterminated template/.test(message)) code = 'syntax-string';
    else if (/Unexpected token/.test(message) && line) code = 'syntax-token';
    else if (/has already been declared/.test(message)) code = 'syntax-redeclare';
    throw new EmuError(code, `SyntaxError: ${message} (${file}:${line}:${(err.loc?.column ?? 0) + 1})`, { message, line: line ?? 0, file }, { line, file });
  }
}

interface Edit { start: number; end: number; text: string }

function importToConst(node: AstNode, src: string): string {
  const from = JSON.stringify(node.source.value);
  const named: string[] = [];
  let def = '';
  let ns = '';
  for (const s of node.specifiers as AstNode[]) {
    if (s.type === 'ImportDefaultSpecifier') def = s.local.name;
    else if (s.type === 'ImportNamespaceSpecifier') ns = s.local.name;
    else {
      const imported = s.imported.type === 'Identifier' ? s.imported.name : s.imported.value;
      named.push(imported === s.local.name ? imported : `${imported}: ${s.local.name}`);
    }
  }
  const parts: string[] = [];
  if (ns) parts.push(`const ${ns} = __import(${from});`);
  if (def) parts.push(`const ${def} = __import(${from}).default;`);
  if (named.length) parts.push(`const { ${named.join(', ')} } = __import(${from});`);
  if (!parts.length) parts.push(`__import(${from});`);
  // keep the same number of lines
  const newlines = (src.slice(node.start, node.end).match(/\n/g) || []).length;
  return parts.join(' ') + '\n'.repeat(newlines);
}

export function transform(src: string, file: string, isModule: boolean): { code: string; ast: acorn.Program } {
  const ast = parse(src, file);
  const edits: Edit[] = [];
  const exported: string[] = [];

  for (const node of ast.body as AstNode[]) {
    if (node.type === 'ImportDeclaration') {
      edits.push({ start: node.start, end: node.end, text: importToConst(node, src) });
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        edits.push({ start: node.start, end: node.declaration.start, text: '' });
        const d = node.declaration as AstNode;
        if (d.type === 'VariableDeclaration') for (const v of d.declarations as AstNode[]) { if (v.id.type === 'Identifier') exported.push(v.id.name); }
        else if (d.id) exported.push(d.id.name);
      } else {
        // export { a, b as c } — or a re-export: export { expect } from '@playwright/test'
        const from = node.source ? `__import(${JSON.stringify(node.source.value)})` : null;
        const assigns = (node.specifiers as AstNode[]).map((s) => {
          const local = s.local.type === 'Identifier' ? s.local.name : s.local.value;
          const name = s.exported.type === 'Identifier' ? s.exported.name : s.exported.value;
          return `__exports[${JSON.stringify(name)}] = ${from ? `${from}[${JSON.stringify(local)}]` : local};`;
        });
        const newlines = (src.slice(node.start, node.end).match(/\n/g) || []).length;
        edits.push({ start: node.start, end: node.end, text: assigns.join(' ') + '\n'.repeat(newlines) });
      }
    } else if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration as AstNode;
      if ((d.type === 'ClassDeclaration' || d.type === 'FunctionDeclaration') && d.id) {
        edits.push({ start: node.start, end: d.start, text: '' });
        exported.push(`default:${d.id.name}`);
      } else {
        edits.push({ start: node.start, end: d.start, text: '__exports.default = ' });
      }
    }
  }

  // Infinite-loop guard
  walkSimple(ast, {
    WhileStatement: (n) => guard(n as AstNode),
    DoWhileStatement: (n) => guard(n as AstNode),
    ForStatement: (n) => guard(n as AstNode),
    ForInStatement: (n) => guard(n as AstNode),
    ForOfStatement: (n) => guard(n as AstNode),
  });
  function guard(n: AstNode) {
    const body = n.body as AstNode;
    if (body.type === 'BlockStatement') edits.push({ start: body.start + 1, end: body.start + 1, text: '__loopGuard();' });
    else {
      edits.push({ start: body.start, end: body.start, text: '{__loopGuard();' });
      edits.push({ start: body.end, end: body.end, text: '}' });
    }
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (isModule && exported.length) {
    out += '\n;' + exported.map((n) => (n.startsWith('default:') ? `__exports.default = ${n.slice(8)};` : `__exports[${JSON.stringify(n)}] = ${n};`)).join(' ');
  }
  return { code: out, ast };
}
