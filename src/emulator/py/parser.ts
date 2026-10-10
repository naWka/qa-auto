// Recursive-descent parser for the Python subset. Error messages follow CPython where it matters for learners.
import type { Comprehension, Expr, Module, Param, Params, Pos, Stmt } from './ast';
import { PySyntaxError } from './errors';
import { tokenize, unescape, type Comment, type Token } from './lexer';

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield',
]);

const AUG_OPS = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '>>=', '<<=']);

const BLOCK_NAMES: Record<string, string> = {
  def: 'function definition', class: 'class definition', if: "'if' statement", elif: "'elif' statement", else: "'else' statement",
  for: "'for' statement", while: "'while' statement", with: "'with' statement", try: "'try' statement", except: "'except' statement",
  finally: "'finally' statement",
};

interface FnCtx { isAsync: boolean; hasYield: boolean }

export function parseModule(src: string, file: string, comments?: Comment[]): Module {
  const p = new Parser(src, file, tokenize(src, file, comments));
  return { body: p.parseFile(), src, file };
}

/** Parses a single expression (used for f-string replacement fields). */
function parseExprText(text: string, file: string, line: number, offset: number, fn: FnCtx | null): Expr {
  const toks = tokenize(text, file).filter((t) => t.type !== 'newline' && t.type !== 'indent' && t.type !== 'dedent');
  for (const t of toks) {
    t.line += line - 1;
    t.start += offset;
    t.end += offset;
  }
  const p = new Parser(text, file, toks);
  p.fnStack = fn ? [fn] : [];
  p.baseOffset = offset;
  const e = p.parseTestListStar();
  if (p.peek().type !== 'eof') p.fail('f-string: invalid syntax', p.peek());
  return e;
}

class Parser {
  src: string;
  file: string;
  toks: Token[];
  pos = 0;
  fnStack: FnCtx[] = [];
  baseOffset = 0;

  constructor(src: string, file: string, toks: Token[]) {
    this.src = src;
    this.file = file;
    this.toks = toks;
  }

  // ---------- token helpers ----------
  peek(k = 0): Token { return this.toks[Math.min(this.pos + k, this.toks.length - 1)]; }
  next(): Token { return this.toks[this.pos++]; }
  isOp(v: string, k = 0) { const t = this.peek(k); return t.type === 'op' && t.value === v; }
  isKw(v: string, k = 0) { const t = this.peek(k); return t.type === 'name' && t.value === v; }
  eatOp(v: string): boolean { if (this.isOp(v)) { this.pos++; return true; } return false; }
  eatKw(v: string): boolean { if (this.isKw(v)) { this.pos++; return true; } return false; }

  fail(msg: string, t: Token = this.peek(), kind: 'SyntaxError' | 'IndentationError' = 'SyntaxError'): never {
    throw new PySyntaxError(msg, this.file, t.line, t.col, kind);
  }
  expectOp(v: string, msg?: string): Token {
    const t = this.peek();
    if (t.type === 'op' && t.value === v) { this.pos++; return t; }
    if (v === ':' ) this.fail(msg ?? "expected ':'", t);
    if (v === ')' || v === ']' || v === '}') this.fail(msg ?? 'invalid syntax. Perhaps you forgot a comma?', t);
    this.fail(msg ?? 'invalid syntax', t);
  }
  expectName(): Token {
    const t = this.peek();
    if (t.type !== 'name' || KEYWORDS.has(t.value)) this.fail('invalid syntax', t);
    this.pos++;
    return t;
  }
  posOf(t: Token): Pos { return { line: t.line, col: t.col, start: t.start, end: t.end }; }
  span(a: Pos, b: { end: number }): Pos { return { line: a.line, col: a.col, start: a.start, end: b.end }; }
  get prevEnd(): number { return this.toks[this.pos - 1]?.end ?? 0; }

  // ---------- statements ----------
  parseFile(): Stmt[] {
    const body: Stmt[] = [];
    while (this.peek().type !== 'eof') {
      if (this.peek().type === 'newline') { this.pos++; continue; }
      if (this.peek().type === 'indent') this.fail('unexpected indent', this.peek(), 'IndentationError');
      body.push(...this.statement());
    }
    return body;
  }

  block(owner: Token): Stmt[] {
    this.expectOp(':');
    if (this.peek().type === 'newline') {
      this.pos++;
      if (this.peek().type !== 'indent') {
        const what = BLOCK_NAMES[owner.value] ?? 'statement';
        this.fail(`expected an indented block after ${what} on line ${owner.line}`, this.peek(), 'IndentationError');
      }
      this.pos++;
      const body: Stmt[] = [];
      while (this.peek().type !== 'dedent' && this.peek().type !== 'eof') {
        if (this.peek().type === 'newline') { this.pos++; continue; }
        if (this.peek().type === 'indent') this.fail('unexpected indent', this.peek(), 'IndentationError');
        body.push(...this.statement());
      }
      if (this.peek().type === 'dedent') this.pos++;
      return body;
    }
    return this.simpleStatements();
  }

  statement(): Stmt[] {
    const t = this.peek();
    if (t.type === 'op' && t.value === '@') return [this.decorated()];
    if (t.type === 'name') {
      switch (t.value) {
        case 'if': return [this.ifStmt()];
        case 'for': return [this.forStmt()];
        case 'while': return [this.whileStmt()];
        case 'def': return [this.funcDef([], false)];
        case 'class': return [this.classDef([])];
        case 'with': return [this.withStmt()];
        case 'try': return [this.tryStmt()];
        case 'async':
          if (this.isKw('def', 1)) { this.pos++; return [this.funcDef([], true)]; }
          break;
        case 'elif': case 'else': case 'except': case 'finally':
          this.fail('invalid syntax', t);
      }
    }
    return this.simpleStatements();
  }

  simpleStatements(): Stmt[] {
    const out: Stmt[] = [this.simpleStmt()];
    while (this.eatOp(';')) {
      if (this.peek().type === 'newline' || this.peek().type === 'eof') break;
      out.push(this.simpleStmt());
    }
    const t = this.peek();
    if (t.type === 'newline') this.pos++;
    else if (t.type !== 'eof' && t.type !== 'dedent') {
      if (t.type === 'op' && t.value === '=') this.fail("invalid syntax. Maybe you meant '==' or ':=' instead of '='?", t);
      if (t.type === 'string' || t.type === 'name' || t.type === 'number') {
        const prev = this.toks[this.pos - 1];
        if (prev?.type === 'name' && prev.value === 'print') this.fail("Missing parentheses in call to 'print'. Did you mean print(...)?", prev);
        if (this.toks[this.pos - 1]?.type === 'name' && t.type === 'name') this.fail('invalid syntax', t);
        this.fail('invalid syntax. Perhaps you forgot a comma?', t);
      }
      if (t.type === 'op' && t.value === '{') this.fail('invalid syntax', t);
      this.fail('invalid syntax', t);
    }
    return out;
  }

  simpleStmt(): Stmt {
    const t = this.peek();
    const P = this.posOf(t);
    if (t.type === 'name') {
      switch (t.value) {
        case 'pass': this.pos++; return { t: 'Pass', ...P };
        case 'break': this.pos++; return { t: 'Break', ...P };
        case 'continue': this.pos++; return { t: 'Continue', ...P };
        case 'return': {
          this.pos++;
          if (!this.fnStack.length) this.fail("'return' outside function", t);
          const value = this.atStmtEnd() ? null : this.parseTestListStar();
          return { t: 'Return', value, ...this.span(P, { end: this.prevEnd }) };
        }
        case 'raise': {
          this.pos++;
          const exc = this.atStmtEnd() ? null : this.test();
          const cause = this.eatKw('from') ? this.test() : null;
          return { t: 'Raise', exc, cause, ...this.span(P, { end: this.prevEnd }) };
        }
        case 'assert': {
          this.pos++;
          const test = this.test();
          const msg = this.eatOp(',') ? this.test() : null;
          return { t: 'Assert', test, msg, ...this.span(P, { end: this.prevEnd }) };
        }
        case 'del': {
          this.pos++;
          const targets = [this.expr()];
          while (this.eatOp(',')) targets.push(this.expr());
          return { t: 'Del', targets, ...P };
        }
        case 'global': case 'nonlocal': {
          this.pos++;
          const names = [this.expectName().value];
          while (this.eatOp(',')) names.push(this.expectName().value);
          return { t: t.value === 'global' ? 'Global' : 'Nonlocal', names, ...P };
        }
        case 'import': {
          this.pos++;
          const names: Array<{ name: string; asname?: string }> = [];
          do {
            const name = this.dottedName();
            const asname = this.eatKw('as') ? this.expectName().value : undefined;
            names.push({ name, asname });
          } while (this.eatOp(','));
          return { t: 'Import', names, ...P };
        }
        case 'from': {
          this.pos++;
          let level = 0;
          while (this.isOp('.') || this.isOp('...')) level += this.next().value.length;
          const module = this.isKw('import') ? '' : this.dottedName();
          if (!this.eatKw('import')) this.fail('invalid syntax', this.peek());
          const names: Array<{ name: string; asname?: string }> = [];
          if (this.eatOp('*')) names.push({ name: '*' });
          else {
            const paren = this.eatOp('(');
            do {
              if (paren && this.isOp(')')) break;
              const name = this.expectName().value;
              const asname = this.eatKw('as') ? this.expectName().value : undefined;
              names.push({ name, asname });
            } while (this.eatOp(','));
            if (paren) this.expectOp(')');
          }
          return { t: 'ImportFrom', module, level, names, ...P };
        }
        case 'const': case 'let': case 'var':
          if (this.peek(1).type === 'name') this.fail('invalid syntax', this.peek(1));
          break;
        case 'yield':
          break;
      }
    }

    // expression / assignment
    const first = this.parseTestListStar(true);
    if (this.isOp('=')) {
      const targets: Expr[] = [first];
      let value: Expr = first;
      while (this.eatOp('=')) {
        value = this.isKw('yield') ? this.yieldExpr() : this.parseTestListStar(true);
        targets.push(value);
      }
      targets.pop();
      for (const tg of targets) this.checkTarget(tg, 'assign');
      return { t: 'Assign', targets, value, ...this.span(P, { end: this.prevEnd }) };
    }
    const nt = this.peek();
    if (nt.type === 'op' && AUG_OPS.has(nt.value)) {
      this.pos++;
      this.checkTarget(first, 'aug');
      const value = this.isKw('yield') ? this.yieldExpr() : this.parseTestListStar();
      return { t: 'AugAssign', target: first, op: nt.value.slice(0, -1), value, ...this.span(P, { end: this.prevEnd }) };
    }
    if (this.isOp(':') && (first.t === 'Name' || first.t === 'Attribute' || first.t === 'Subscript')) {
      this.pos++;
      const annotation = this.test();
      const value = this.eatOp('=') ? this.parseTestListStar() : null;
      return { t: 'AnnAssign', target: first, annotation, value, ...this.span(P, { end: this.prevEnd }) };
    }
    return { t: 'Expr', value: first, ...this.span(P, { end: this.prevEnd }) };
  }

  checkTarget(e: Expr, kind: 'assign' | 'aug' | 'for'): void {
    switch (e.t) {
      case 'Name': return;
      case 'Attribute': case 'Subscript': return;
      case 'Tuple': case 'List':
        if (kind === 'aug') this.failAt(e, "'tuple' is an illegal expression for augmented assignment");
        e.elts.forEach((x) => this.checkTarget(x.t === 'Starred' ? x.value : x, kind));
        return;
      case 'Call': this.failAt(e, kind === 'for' ? 'cannot assign to function call' : "cannot assign to function call here. Maybe you meant '==' instead of '='?");
      // falls through (failAt throws)
      case 'Const': this.failAt(e, "cannot assign to literal here. Maybe you meant '==' instead of '='?");
      // falls through
      default: this.failAt(e, 'cannot assign to expression');
    }
  }
  failAt(e: Pos, msg: string): never {
    throw new PySyntaxError(msg, this.file, e.line, e.col);
  }

  atStmtEnd(): boolean {
    const t = this.peek();
    return t.type === 'newline' || t.type === 'eof' || t.type === 'dedent' || (t.type === 'op' && t.value === ';');
  }

  dottedName(): string {
    let name = this.expectName().value;
    while (this.eatOp('.')) name += '.' + this.expectName().value;
    return name;
  }

  decorated(): Stmt {
    const decorators: Expr[] = [];
    while (this.eatOp('@')) {
      decorators.push(this.namedExprTest());
      if (this.peek().type !== 'newline') this.fail('invalid syntax', this.peek());
      this.pos++;
    }
    if (this.isKw('def')) return this.funcDef(decorators, false);
    if (this.isKw('async') && this.isKw('def', 1)) { this.pos++; return this.funcDef(decorators, true); }
    if (this.isKw('class')) return this.classDef(decorators);
    this.fail('invalid syntax', this.peek());
  }

  ifStmt(): Stmt {
    const kw = this.next();
    const P = this.posOf(kw);
    const test = this.namedExprTest();
    const body = this.block(kw);
    let orelse: Stmt[] = [];
    if (this.isKw('elif')) {
      orelse = [this.ifStmt()];
    } else if (this.isKw('else')) {
      const e = this.next();
      orelse = this.block(e);
    }
    return { t: 'If', test, body, orelse, ...P };
  }

  forStmt(): Stmt {
    const kw = this.next();
    const P = this.posOf(kw);
    const target = this.targetList();
    this.checkTarget(target, 'for');
    if (!this.eatKw('in')) this.fail("invalid syntax", this.peek());
    const iter = this.parseTestListStar();
    const body = this.block(kw);
    let orelse: Stmt[] = [];
    if (this.isKw('else')) { const e = this.next(); orelse = this.block(e); }
    return { t: 'For', target, iter, body, orelse, ...this.span(P, { end: iter.end }) };
  }

  whileStmt(): Stmt {
    const kw = this.next();
    const P = this.posOf(kw);
    const test = this.namedExprTest();
    const body = this.block(kw);
    let orelse: Stmt[] = [];
    if (this.isKw('else')) { const e = this.next(); orelse = this.block(e); }
    return { t: 'While', test, body, orelse, ...P };
  }

  withStmt(): Stmt {
    const kw = this.next();
    const P = this.posOf(kw);
    const items: Array<{ ctx: Expr; vars: Expr | null }> = [];
    do {
      const ctx = this.test();
      const vars = this.eatKw('as') ? this.targetAtom() : null;
      items.push({ ctx, vars });
    } while (this.eatOp(','));
    const body = this.block(kw);
    return { t: 'With', items, body, ...this.span(P, { end: items[items.length - 1].ctx.end }) };
  }

  tryStmt(): Stmt {
    const kw = this.next();
    const P = this.posOf(kw);
    const body = this.block(kw);
    const handlers: Array<{ type: Expr | null; name: string | null; body: Stmt[]; line: number }> = [];
    while (this.isKw('except')) {
      const ek = this.next();
      let type: Expr | null = null;
      let name: string | null = null;
      if (!this.isOp(':')) {
        type = this.test();
        if (this.eatOp(',')) {
          const elts = [type, this.test()];
          while (this.eatOp(',')) elts.push(this.test());
          type = { t: 'Tuple', elts, ...this.span(type, { end: this.prevEnd }) };
        }
        if (this.eatKw('as')) name = this.expectName().value;
      }
      handlers.push({ type, name, body: this.block(ek), line: ek.line });
    }
    let orelse: Stmt[] = [];
    let finalbody: Stmt[] = [];
    if (this.isKw('else')) { const e = this.next(); orelse = this.block(e); }
    if (this.isKw('finally')) { const f = this.next(); finalbody = this.block(f); }
    if (!handlers.length && !finalbody.length) this.fail("expected 'except' or 'finally' block", this.peek());
    return { t: 'Try', body, handlers, orelse, finalbody, ...P };
  }

  funcDef(decorators: Expr[], isAsync: boolean): Stmt {
    const kw = this.next();
    const P = this.posOf(kw);
    const name = this.expectName().value;
    this.expectOp('(', "invalid syntax");
    const args = this.params(')', true);
    this.expectOp(')');
    let returns: Expr | null = null;
    if (this.eatOp('->')) returns = this.test();
    const ctx: FnCtx = { isAsync, hasYield: false };
    this.fnStack.push(ctx);
    const body = this.block(kw);
    this.fnStack.pop();
    const endLine = this.toks[this.pos - 1]?.line ?? kw.line;
    return { t: 'FunctionDef', name, args, body, decorators, returns, isAsync, isGenerator: ctx.hasYield, endLine, ...P };
  }

  params(close: string, annotations: boolean): Params {
    const list: Param[] = [];
    let kwonly = false;
    while (!this.isOp(close) && !(close === ':' && this.isOp(':'))) {
      if (this.eatOp('/')) { if (!this.eatOp(',')) break; continue; }
      if (this.eatOp('**')) {
        const n = this.expectName().value;
        const annotation = annotations && this.eatOp(':') ? this.test() : undefined;
        list.push({ name: n, kind: 'kwarg', annotation });
      } else if (this.eatOp('*')) {
        if (this.isOp(',')) kwonly = true;
        else {
          const n = this.expectName().value;
          const annotation = annotations && this.eatOp(':') ? this.test() : undefined;
          list.push({ name: n, kind: 'vararg', annotation });
          kwonly = true;
        }
      } else {
        const t = this.peek();
        if (t.type === 'op' && t.value === '{') this.fail('invalid syntax', t);
        const n = this.expectName().value;
        const annotation = annotations && this.eatOp(':') ? this.test() : undefined;
        const def = this.eatOp('=') ? this.test() : undefined;
        if (!def && !kwonly && list.some((p) => p.kind === 'pos' && p.default)) this.fail('non-default argument follows default argument', t);
        list.push({ name: n, default: def, kind: kwonly ? 'kwonly' : 'pos', annotation });
      }
      if (!this.eatOp(',')) break;
    }
    const seen = new Set<string>();
    for (const p of list) {
      if (seen.has(p.name)) this.fail(`duplicate argument '${p.name}' in function definition`, this.peek());
      seen.add(p.name);
    }
    return { list };
  }

  classDef(decorators: Expr[]): Stmt {
    const kw = this.next();
    const P = this.posOf(kw);
    const name = this.expectName().value;
    let bases: Expr[] = [];
    let keywords: Array<{ arg: string | null; value: Expr }> = [];
    if (this.eatOp('(')) {
      const a = this.callArgs();
      bases = a.args;
      keywords = a.keywords;
    }
    const saved = this.fnStack;
    this.fnStack = [];
    const body = this.block(kw);
    this.fnStack = saved;
    const endLine = this.toks[this.pos - 1]?.line ?? kw.line;
    return { t: 'ClassDef', name, bases, keywords, body, decorators, endLine, ...P };
  }

  // ---------- expressions ----------
  /** testlist_star_expr: a, *b, c → Tuple */
  parseTestListStar(allowYield = false): Expr {
    if (allowYield && this.isKw('yield')) return this.yieldExpr();
    const first = this.starOrTest();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.endOfList()) break;
      elts.push(this.starOrTest());
    }
    return { t: 'Tuple', elts, ...this.span(first, { end: this.prevEnd }) };
  }
  endOfList(): boolean {
    const t = this.peek();
    if (t.type === 'newline' || t.type === 'eof' || t.type === 'dedent') return true;
    return t.type === 'op' && ['=', ')', ']', '}', ':', ';'].includes(t.value) || AUG_OPS.has(t.value);
  }
  starOrTest(): Expr {
    if (this.isOp('*')) {
      const s = this.next();
      const value = this.expr();
      return { t: 'Starred', value, ...this.span(this.posOf(s), value) };
    }
    return this.namedExprTest();
  }

  targetList(): Expr {
    const first = this.targetAtom();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.isKw('in') || this.isOp('=')) break;
      elts.push(this.targetAtom());
    }
    return { t: 'Tuple', elts, ...this.span(first, { end: this.prevEnd }) };
  }
  targetAtom(): Expr {
    if (this.isOp('*')) {
      const s = this.next();
      const value = this.expr();
      return { t: 'Starred', value, ...this.span(this.posOf(s), value) };
    }
    return this.expr();
  }

  yieldExpr(): Expr {
    const kw = this.next();
    const fn = this.fnStack[this.fnStack.length - 1];
    if (!fn) this.fail("'yield' outside function", kw);
    fn.hasYield = true;
    if (this.eatKw('from')) {
      const v = this.test();
      return { t: 'Yield', value: v, ...this.span(this.posOf(kw), v) };
    }
    const value = this.atStmtEnd() || this.isOp(')') ? null : this.parseTestListStar();
    return { t: 'Yield', value, ...this.span(this.posOf(kw), { end: this.prevEnd }) };
  }

  namedExprTest(): Expr {
    const t = this.peek();
    if (t.type === 'name' && this.isOp(':=', 1)) {
      this.pos += 2;
      const value = this.test();
      return { t: 'NamedExpr', target: t.value, value, ...this.span(this.posOf(t), value) };
    }
    return this.test();
  }

  test(): Expr {
    if (this.isKw('lambda')) return this.lambda();
    const body = this.orTest();
    if (this.isKw('if') && !this.isLineStartIf()) {
      this.pos++;
      const test = this.orTest();
      if (!this.eatKw('else')) this.fail("expected 'else' after 'if' expression", this.peek());
      const orelse = this.test();
      return { t: 'IfExp', test, body, orelse, ...this.span(body, orelse) };
    }
    return body;
  }
  isLineStartIf(): boolean { return false; }

  testNoCond(): Expr {
    if (this.isKw('lambda')) return this.lambda();
    return this.orTest();
  }

  lambda(): Expr {
    const kw = this.next();
    const args = this.params(':', false);
    this.expectOp(':');
    this.fnStack.push({ isAsync: false, hasYield: false });
    const body = this.test();
    this.fnStack.pop();
    return { t: 'Lambda', args, body, ...this.span(this.posOf(kw), body) };
  }

  orTest(): Expr {
    const first = this.andTest();
    if (!this.isKw('or')) return first;
    const values = [first];
    while (this.eatKw('or')) values.push(this.andTest());
    return { t: 'BoolOp', op: 'or', values, ...this.span(first, values[values.length - 1]) };
  }
  andTest(): Expr {
    const first = this.notTest();
    if (!this.isKw('and')) return first;
    const values = [first];
    while (this.eatKw('and')) values.push(this.notTest());
    return { t: 'BoolOp', op: 'and', values, ...this.span(first, values[values.length - 1]) };
  }
  notTest(): Expr {
    if (this.isKw('not')) {
      const kw = this.next();
      const operand = this.notTest();
      return { t: 'UnaryOp', op: 'not', operand, ...this.span(this.posOf(kw), operand) };
    }
    return this.comparison();
  }
  comparison(): Expr {
    const left = this.expr();
    const ops: string[] = [];
    const comparators: Expr[] = [];
    for (;;) {
      const t = this.peek();
      let op: string | null = null;
      if (t.type === 'op' && ['<', '>', '==', '>=', '<=', '!='].includes(t.value)) { op = t.value; this.pos++; }
      else if (t.type === 'op' && t.value === '===') { this.fail('invalid syntax', t); }
      else if (this.isKw('in')) { op = 'in'; this.pos++; }
      else if (this.isKw('not') && this.isKw('in', 1)) { op = 'not in'; this.pos += 2; }
      else if (this.isKw('is')) { this.pos++; op = this.eatKw('not') ? 'is not' : 'is'; }
      if (!op) break;
      if (this.isOp('=')) this.fail('invalid syntax', this.peek());
      ops.push(op);
      comparators.push(this.expr());
    }
    if (!ops.length) return left;
    return { t: 'Compare', left, ops, comparators, ...this.span(left, comparators[comparators.length - 1]) };
  }

  expr(): Expr { return this.binary(0); }

  static LEVELS: string[][] = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '//', '%', '@']];

  binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.factor();
    let left = this.binary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.type !== 'op' || !Parser.LEVELS[level].includes(t.value)) break;
      this.pos++;
      const right = this.binary(level + 1);
      left = { t: 'BinOp', op: t.value, left, right, ...this.span(left, right) };
    }
    return left;
  }

  factor(): Expr {
    const t = this.peek();
    if (t.type === 'op' && (t.value === '-' || t.value === '+' || t.value === '~')) {
      this.pos++;
      const operand = this.factor();
      return { t: 'UnaryOp', op: t.value, operand, ...this.span(this.posOf(t), operand) };
    }
    if (t.type === 'op' && t.value === '!') this.fail('invalid syntax', t);
    return this.power();
  }

  power(): Expr {
    let base: Expr;
    if (this.isKw('await')) {
      const kw = this.next();
      const fn = this.fnStack[this.fnStack.length - 1];
      if (!fn) this.fail("'await' outside function", kw);
      if (!fn.isAsync) this.fail("'await' outside async function", kw);
      const value = this.primary();
      base = { t: 'Await', value, ...this.span(this.posOf(kw), value) };
    } else base = this.primary();
    if (this.isOp('**')) {
      this.pos++;
      const exp = this.factor();
      return { t: 'BinOp', op: '**', left: base, right: exp, ...this.span(base, exp) };
    }
    return base;
  }

  primary(): Expr {
    let e = this.atom();
    for (;;) {
      if (this.isOp('.')) {
        this.pos++;
        const nt = this.peek();
        if (nt.type !== 'name') this.fail('invalid syntax', nt);
        this.pos++;
        e = { t: 'Attribute', value: e, attr: nt.value, ...this.span(e, nt) };
      } else if (this.isOp('(')) {
        this.pos++;
        const { args, keywords } = this.callArgs();
        e = { t: 'Call', func: e, args, keywords, ...this.span(e, { end: this.prevEnd }) };
      } else if (this.isOp('[')) {
        this.pos++;
        const slice = this.subscript();
        this.expectOp(']');
        e = { t: 'Subscript', value: e, slice, ...this.span(e, { end: this.prevEnd }) };
      } else break;
    }
    return e;
  }

  /** Arguments after "(" up to and including ")". */
  callArgs(): { args: Expr[]; keywords: Array<{ arg: string | null; value: Expr }> } {
    const args: Expr[] = [];
    const keywords: Array<{ arg: string | null; value: Expr }> = [];
    while (!this.isOp(')')) {
      const t = this.peek();
      if (t.type === 'op' && t.value === '**') {
        this.pos++;
        keywords.push({ arg: null, value: this.test() });
      } else if (t.type === 'op' && t.value === '*') {
        this.pos++;
        const value = this.test();
        args.push({ t: 'Starred', value, ...this.span(this.posOf(t), value) });
      } else if (t.type === 'name' && this.isOp('=', 1) && !KEYWORDS.has(t.value)) {
        this.pos += 2;
        if (keywords.some((k) => k.arg === t.value)) this.fail(`keyword argument repeated: ${t.value}`, t);
        keywords.push({ arg: t.value, value: this.test() });
      } else {
        if (t.type === 'op' && t.value === '{') {
          // JS-style options object: getByRole('button', { name: 'Log in' })
          const save = this.pos;
          try { this.test(); } catch { this.pos = save; this.fail('invalid syntax', t); }
          this.pos = save;
        }
        if (keywords.length && !(t.type === 'op' && t.value === '*')) {
          const value = this.test();
          this.failAt(value, 'positional argument follows keyword argument');
        }
        const value = this.namedExprTest();
        if (this.isKw('for')) {
          const gens = this.compFor();
          args.push({ t: 'Comp', kind: 'gen', elt: value, gens, ...this.span(value, { end: this.prevEnd }) });
        } else args.push(value);
        if (this.isOp('=')) this.fail('expression cannot contain assignment, perhaps you meant "=="?', this.peek());
      }
      if (!this.eatOp(',')) break;
    }
    if (!this.isOp(')')) {
      const t = this.peek();
      if (t.type === 'op' && t.value === ':' ) this.fail('invalid syntax', t);
      this.fail('invalid syntax. Perhaps you forgot a comma?', t);
    }
    this.pos++;
    return { args, keywords };
  }

  subscript(): Expr {
    const first = this.sliceItem();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.isOp(']')) break;
      elts.push(this.sliceItem());
    }
    return { t: 'Tuple', elts, ...this.span(first, { end: this.prevEnd }) };
  }
  sliceItem(): Expr {
    const start = this.peek();
    let lower: Expr | null = null;
    if (!this.isOp(':')) {
      lower = this.test();
      if (!this.isOp(':')) return lower;
    }
    this.expectOp(':');
    const upper = this.isOp(':') || this.isOp(']') || this.isOp(',') ? null : this.test();
    let step: Expr | null = null;
    if (this.eatOp(':')) step = this.isOp(']') || this.isOp(',') ? null : this.test();
    return { t: 'Slice', lower, upper, step, ...this.span(this.posOf(start), { end: this.prevEnd }) };
  }

  compFor(): Comprehension[] {
    const gens: Comprehension[] = [];
    while (this.isKw('for') || (this.isKw('async') && this.isKw('for', 1))) {
      if (this.isKw('async')) this.pos++;
      this.pos++;
      const target = this.targetList();
      this.checkTarget(target, 'for');
      if (!this.eatKw('in')) this.fail('invalid syntax', this.peek());
      const iter = this.orTest();
      const ifs: Expr[] = [];
      while (this.isKw('if')) {
        this.pos++;
        ifs.push(this.testNoCond());
      }
      gens.push({ target, iter, ifs });
    }
    return gens;
  }

  atom(): Expr {
    const t = this.peek();
    const P = this.posOf(t);
    if (t.type === 'number') {
      this.pos++;
      const raw = t.value.replace(/_/g, '');
      let value: number;
      let kind: 'int' | 'float' = 'int';
      if (/^0[xX]/.test(raw)) value = parseInt(raw.slice(2), 16);
      else if (/^0[oO]/.test(raw)) value = parseInt(raw.slice(2), 8);
      else if (/^0[bB]/.test(raw)) value = parseInt(raw.slice(2), 2);
      else {
        value = Number(raw);
        if (/[.eE]/.test(raw)) kind = 'float';
        else if (/^0\d/.test(raw)) this.fail('leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers', t);
      }
      return { t: 'Const', value, kind, ...P };
    }
    if (t.type === 'string' || t.type === 'fstring') return this.strings();
    if (t.type === 'name') {
      switch (t.value) {
        case 'None': this.pos++; return { t: 'Const', value: null, ...P };
        case 'True': this.pos++; return { t: 'Const', value: true, ...P };
        case 'False': this.pos++; return { t: 'Const', value: false, ...P };
        case 'lambda': return this.lambda();
        case 'yield': this.fail('invalid syntax', t);
      }
      if (KEYWORDS.has(t.value)) {
        if (t.value === 'await') return this.power();
        this.fail('invalid syntax', t);
      }
      this.pos++;
      return { t: 'Name', id: t.value, ...P };
    }
    if (t.type === 'op') {
      if (t.value === '...') { this.pos++; return { t: 'Const', value: null, kind: 'ellipsis', ...P }; }
      if (t.value === '(') {
        this.pos++;
        if (this.eatOp(')')) return { t: 'Tuple', elts: [], ...this.span(P, { end: this.prevEnd }) };
        if (this.isKw('yield')) {
          const y = this.yieldExpr();
          this.expectOp(')');
          return y;
        }
        const first = this.starOrTest();
        if (this.isKw('for')) {
          const gens = this.compFor();
          this.expectOp(')');
          return { t: 'Comp', kind: 'gen', elt: first, gens, ...this.span(P, { end: this.prevEnd }) };
        }
        if (this.eatOp(')')) {
          // keep parentheses in the span (matters for source excerpts)
          return { ...first, ...(first.t === 'Tuple' ? this.span(P, { end: this.prevEnd }) : {}) } as Expr;
        }
        const elts = [first];
        while (this.eatOp(',')) {
          if (this.isOp(')')) break;
          elts.push(this.starOrTest());
        }
        this.expectOp(')');
        return { t: 'Tuple', elts, ...this.span(P, { end: this.prevEnd }) };
      }
      if (t.value === '[') {
        this.pos++;
        if (this.eatOp(']')) return { t: 'List', elts: [], ...this.span(P, { end: this.prevEnd }) };
        const first = this.starOrTest();
        if (this.isKw('for')) {
          const gens = this.compFor();
          this.expectOp(']');
          return { t: 'Comp', kind: 'list', elt: first, gens, ...this.span(P, { end: this.prevEnd }) };
        }
        const elts = [first];
        while (this.eatOp(',')) {
          if (this.isOp(']')) break;
          elts.push(this.starOrTest());
        }
        this.expectOp(']');
        return { t: 'List', elts, ...this.span(P, { end: this.prevEnd }) };
      }
      if (t.value === '{') {
        this.pos++;
        if (this.eatOp('}')) return { t: 'Dict', keys: [], values: [], ...this.span(P, { end: this.prevEnd }) };
        if (this.isOp('**')) {
          return this.dictRest(P, null, null);
        }
        const first = this.starOrTest();
        if (this.eatOp(':')) {
          const v = this.test();
          if (this.isKw('for')) {
            const gens = this.compFor();
            this.expectOp('}');
            return { t: 'Comp', kind: 'dict', elt: first, value: v, gens, ...this.span(P, { end: this.prevEnd }) };
          }
          return this.dictRest(P, first, v);
        }
        if (first.t === 'Name' && (this.isOp(',') || this.isOp('}')) && /^[a-z]/.test(first.id) && false) {
          /* unreachable: JS shorthand is a valid Python set */
        }
        if (this.isKw('for')) {
          const gens = this.compFor();
          this.expectOp('}');
          return { t: 'Comp', kind: 'set', elt: first, gens, ...this.span(P, { end: this.prevEnd }) };
        }
        const elts = [first];
        while (this.eatOp(',')) {
          if (this.isOp('}')) break;
          elts.push(this.starOrTest());
        }
        this.expectOp('}', "invalid syntax");
        return { t: 'Set', elts, ...this.span(P, { end: this.prevEnd }) };
      }
    }
    if (t.type === 'newline' || t.type === 'eof') this.fail('invalid syntax', t);
    if (t.type === 'indent') this.fail('unexpected indent', t, 'IndentationError');
    this.fail('invalid syntax', t);
  }

  dictRest(P: Pos, k: Expr | null, v: Expr | null): Expr {
    const keys: Array<Expr | null> = [];
    const values: Expr[] = [];
    if (v) { keys.push(k); values.push(v); if (!this.eatOp(',')) { this.expectOp('}'); return { t: 'Dict', keys, values, ...this.span(P, { end: this.prevEnd }) }; } }
    while (!this.isOp('}')) {
      if (this.eatOp('**')) {
        keys.push(null);
        values.push(this.expr());
      } else {
        const key = this.test();
        if (!this.isOp(':')) this.fail("':' expected after dictionary key", this.peek());
        this.pos++;
        keys.push(key);
        values.push(this.test());
      }
      if (!this.eatOp(',')) break;
    }
    this.expectOp('}');
    return { t: 'Dict', keys, values, ...this.span(P, { end: this.prevEnd }) };
  }

  /** Adjacent string literals are concatenated; f-strings become FString nodes. */
  strings(): Expr {
    const first = this.peek();
    const P = this.posOf(first);
    const parts: Array<string | { expr: Expr; conv?: string; spec?: Expr | string; text: string }> = [];
    let anyF = false;
    while (this.peek().type === 'string' || this.peek().type === 'fstring') {
      const t = this.next();
      if (t.type === 'string') parts.push(t.str!);
      else {
        anyF = true;
        const prefixLen = /^[rRfF]+/.exec(t.value)![0].length;
        const q = t.value[prefixLen];
        const qLen = t.value.slice(prefixLen, prefixLen + 3) === q.repeat(3) ? 3 : 1;
        parts.push(...this.fstringParts(t.str!, t.raw!, t.line, t.start + prefixLen + qLen));
      }
    }
    const end = this.prevEnd;
    if (!anyF) return { t: 'Const', value: parts.join(''), kind: 'str', ...this.span(P, { end }) };
    // merge adjacent literal pieces
    const merged: typeof parts = [];
    for (const p of parts) {
      if (typeof p === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] += p;
      else merged.push(p);
    }
    return { t: 'FString', parts: merged, ...this.span(P, { end }) };
  }

  fstringParts(body: string, raw: boolean, line: number, offset: number): Array<string | { expr: Expr; conv?: string; spec?: Expr | string; text: string }> {
    const out: Array<string | { expr: Expr; conv?: string; spec?: Expr | string; text: string }> = [];
    let lit = '';
    let i = 0;
    const fn = this.fnStack[this.fnStack.length - 1] ?? null;
    const flush = () => { if (lit) { out.push(raw ? lit : unescape(lit)); lit = ''; } };
    while (i < body.length) {
      const c = body[i];
      if (c === '{' && body[i + 1] === '{') { lit += '{'; i += 2; continue; }
      if (c === '}' && body[i + 1] === '}') { lit += '}'; i += 2; continue; }
      if (c === '}') throw new PySyntaxError("f-string: single '}' is not allowed", this.file, line, 1);
      if (c !== '{') { lit += c; i++; continue; }
      flush();
      // find the end of the replacement field, respecting nesting and strings
      let j = i + 1;
      let depth = 0;
      let quote: string | null = null;
      let exprEnd = -1;
      let convAt = -1;
      let specAt = -1;
      for (; j < body.length; j++) {
        const ch = body[j];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if ((ch === ')' || ch === ']') && depth > 0) { depth--; continue; }
        if (ch === '}' && depth > 0 && specAt < 0) { depth--; continue; }
        if (depth === 0 && specAt < 0) {
          if (ch === '!' && body[j + 1] !== '=' && convAt < 0) { convAt = j; continue; }
          if (ch === ':' ) { specAt = j; continue; }
        }
        if (ch === '}' && depth === 0) { exprEnd = j; break; }
        if (ch === '{' && specAt >= 0) depth++;
      }
      if (exprEnd < 0) throw new PySyntaxError("f-string: expecting '}'", this.file, line, 1);
      const exprStop = convAt >= 0 ? convAt : specAt >= 0 ? specAt : exprEnd;
      let exprText = body.slice(i + 1, exprStop);
      let debugText = '';
      if (/=\s*$/.test(exprText) && !/[=!<>]=\s*$/.test(exprText)) {
        debugText = exprText;
        exprText = exprText.replace(/=\s*$/, '');
      }
      if (!exprText.trim()) throw new PySyntaxError('f-string: valid expression required before \'}\'', this.file, line, 1);
      const expr = parseExprText(exprText, this.file, line, offset + i + 1, fn);
      const conv = convAt >= 0 ? body.slice(convAt + 1, specAt >= 0 ? specAt : exprEnd) : undefined;
      let spec: Expr | string | undefined;
      if (specAt >= 0) {
        const specText = body.slice(specAt + 1, exprEnd);
        if (specText.includes('{')) {
          const sub = this.fstringParts(specText, true, line, offset + specAt + 1);
          spec = { t: 'FString', parts: sub, line, col: 1, start: offset + specAt + 1, end: offset + exprEnd };
        } else spec = specText;
      }
      if (debugText) out.push(debugText);
      out.push({ expr, conv: conv ?? (debugText && spec === undefined ? 'r' : undefined), spec, text: exprText.trim() });
      i = exprEnd + 1;
    }
    flush();
    return out;
  }
}
