// Errors raised while compiling Python source (before anything runs).
export class PySyntaxError extends Error {
  file: string;
  line: number;
  col: number;
  kind: 'SyntaxError' | 'IndentationError';
  constructor(message: string, file: string, line: number, col: number, kind: 'SyntaxError' | 'IndentationError' = 'SyntaxError') {
    super(message);
    this.name = kind;
    this.kind = kind;
    this.file = file;
    this.line = line;
    this.col = col;
  }
}
