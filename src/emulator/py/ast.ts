// AST of the Python subset understood by the emulator.

export interface Pos { line: number; col: number; start: number; end: number }

export type Expr =
  | { t: 'Name'; id: string } & Pos
  | { t: 'Const'; value: string | number | boolean | null; kind?: 'str' | 'int' | 'float' | 'ellipsis' } & Pos
  | { t: 'FString'; parts: Array<string | { expr: Expr; conv?: string; spec?: Expr | string; text: string }> } & Pos
  | { t: 'List'; elts: Expr[] } & Pos
  | { t: 'Tuple'; elts: Expr[] } & Pos
  | { t: 'Set'; elts: Expr[] } & Pos
  | { t: 'Dict'; keys: Array<Expr | null>; values: Expr[] } & Pos
  | { t: 'Starred'; value: Expr } & Pos
  | { t: 'Attribute'; value: Expr; attr: string } & Pos
  | { t: 'Subscript'; value: Expr; slice: Expr } & Pos
  | { t: 'Slice'; lower: Expr | null; upper: Expr | null; step: Expr | null } & Pos
  | { t: 'Call'; func: Expr; args: Expr[]; keywords: Array<{ arg: string | null; value: Expr }> } & Pos
  | { t: 'BinOp'; op: string; left: Expr; right: Expr } & Pos
  | { t: 'UnaryOp'; op: string; operand: Expr } & Pos
  | { t: 'BoolOp'; op: 'and' | 'or'; values: Expr[] } & Pos
  | { t: 'Compare'; left: Expr; ops: string[]; comparators: Expr[] } & Pos
  | { t: 'IfExp'; test: Expr; body: Expr; orelse: Expr } & Pos
  | { t: 'Lambda'; args: Params; body: Expr } & Pos
  | { t: 'Comp'; kind: 'list' | 'set' | 'gen' | 'dict'; elt: Expr; value?: Expr; gens: Comprehension[] } & Pos
  | { t: 'NamedExpr'; target: string; value: Expr } & Pos
  | { t: 'Yield'; value: Expr | null } & Pos
  | { t: 'Await'; value: Expr } & Pos;

export interface Comprehension { target: Expr; iter: Expr; ifs: Expr[] }

export interface Param { name: string; default?: Expr; kind: 'pos' | 'vararg' | 'kwonly' | 'kwarg'; annotation?: Expr }
export interface Params { list: Param[] }

export type Stmt =
  | { t: 'Expr'; value: Expr } & Pos
  | { t: 'Assign'; targets: Expr[]; value: Expr } & Pos
  | { t: 'AugAssign'; target: Expr; op: string; value: Expr } & Pos
  | { t: 'AnnAssign'; target: Expr; annotation: Expr; value: Expr | null } & Pos
  | { t: 'Pass' } & Pos
  | { t: 'Break' } & Pos
  | { t: 'Continue' } & Pos
  | { t: 'Return'; value: Expr | null } & Pos
  | { t: 'Raise'; exc: Expr | null; cause: Expr | null } & Pos
  | { t: 'Assert'; test: Expr; msg: Expr | null } & Pos
  | { t: 'Del'; targets: Expr[] } & Pos
  | { t: 'Global'; names: string[] } & Pos
  | { t: 'Nonlocal'; names: string[] } & Pos
  | { t: 'Import'; names: Array<{ name: string; asname?: string }> } & Pos
  | { t: 'ImportFrom'; module: string; level: number; names: Array<{ name: string; asname?: string }> } & Pos
  | { t: 'If'; test: Expr; body: Stmt[]; orelse: Stmt[] } & Pos
  | { t: 'For'; target: Expr; iter: Expr; body: Stmt[]; orelse: Stmt[] } & Pos
  | { t: 'While'; test: Expr; body: Stmt[]; orelse: Stmt[] } & Pos
  | { t: 'With'; items: Array<{ ctx: Expr; vars: Expr | null }>; body: Stmt[] } & Pos
  | { t: 'Try'; body: Stmt[]; handlers: Array<{ type: Expr | null; name: string | null; body: Stmt[]; line: number }>; orelse: Stmt[]; finalbody: Stmt[] } & Pos
  | { t: 'FunctionDef'; name: string; args: Params; body: Stmt[]; decorators: Expr[]; returns: Expr | null; isAsync: boolean; isGenerator: boolean; endLine: number } & Pos
  | { t: 'ClassDef'; name: string; bases: Expr[]; keywords: Array<{ arg: string | null; value: Expr }>; body: Stmt[]; decorators: Expr[]; endLine: number } & Pos;

export interface Module { body: Stmt[]; src: string; file: string }

/** Source text of a node. */
export function srcOf(mod: { src: string }, n: Pos): string {
  return mod.src.slice(n.start, n.end);
}
