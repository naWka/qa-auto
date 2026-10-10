import type { Expr, Stmt, Params } from './ast';

/** What a PyFunction needs from its definition: a def statement or a lambda. */
export interface FunctionDefNode {
  name: string;
  args: Params;
  body: Stmt[] | Expr;
  isGenerator: boolean;
  line: number;
  file: string;
  /** source of the module that defined it (for tracebacks) */
  isLambda: boolean;
}
