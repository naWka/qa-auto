// Tokenizer for the Python subset used in tests: indentation, implicit line joining inside brackets,
// strings (raw, f-strings, triple-quoted), comments.
import { PySyntaxError } from './errors';

export type TokType = 'name' | 'number' | 'string' | 'fstring' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof';

export interface Token {
  type: TokType;
  value: string;
  line: number;
  col: number;
  /** offset in the source (start, end) */
  start: number;
  end: number;
  /** string tokens: decoded value; raw flag */
  str?: string;
  raw?: boolean;
}

const OPS = [
  '**=', '//=', '>>=', '<<=', '...',
  '->', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', ':=', '<<', '>>',
  '+', '-', '*', '/', '%', '@', '<', '>', '=', '.', ',', ':', ';', '(', ')', '[', ']', '{', '}', '&', '|', '^', '~',
];

export interface Comment { start: number; end: number; line: number }

export function tokenize(src: string, file: string, comments?: Comment[]): Token[] {
  const toks: Token[] = [];
  const indents = [0];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let depth = 0; // bracket depth
  let atLineStart = true;
  const n = src.length;
  const err = (msg: string, l = line, c = i - lineStart + 1): never => {
    throw new PySyntaxError(msg, file, l, c, /indent/.test(msg) ? 'IndentationError' : 'SyntaxError');
  };

  while (i <= n) {
    if (atLineStart && depth === 0) {
      // measure indentation
      let col = 0;
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) {
        col += src[j] === '\t' ? 8 - (col % 8) : 1;
        j++;
      }
      // blank line or comment-only line: skip
      if (j >= n || src[j] === '\n' || src[j] === '#' || (src[j] === '\r' && src[j + 1] === '\n')) {
        if (j < n && src[j] === '#') {
          const e = src.indexOf('\n', j);
          const end = e < 0 ? n : e;
          comments?.push({ start: j, end, line });
          j = end;
        }
        if (j >= n) { i = n; atLineStart = false; break; }
        i = src[j] === '\r' ? j + 2 : j + 1;
        line++;
        lineStart = i;
        continue;
      }
      i = j;
      const top = indents[indents.length - 1];
      if (col > top) {
        indents.push(col);
        toks.push({ type: 'indent', value: '', line, col: 1, start: i, end: i });
      } else if (col < top) {
        while (col < indents[indents.length - 1]) {
          indents.pop();
          toks.push({ type: 'dedent', value: '', line, col: 1, start: i, end: i });
        }
        if (col !== indents[indents.length - 1]) err('unindent does not match any outer indentation level', line, col + 1);
      }
      atLineStart = false;
    }
    if (i >= n) break;
    const ch = src[i];
    const col = i - lineStart + 1;

    if (ch === '\n' || (ch === '\r' && src[i + 1] === '\n')) {
      if (depth === 0) {
        const last = toks[toks.length - 1];
        if (last && last.type !== 'newline' && last.type !== 'indent' && last.type !== 'dedent') {
          toks.push({ type: 'newline', value: '', line, col, start: i, end: i });
        }
        atLineStart = true;
      }
      i += ch === '\r' ? 2 : 1;
      line++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f') { i++; continue; }
    if (ch === '#') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      comments?.push({ start: i, end, line });
      i = end;
      continue;
    }
    if (ch === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
      i += src[i + 1] === '\r' ? 3 : 2;
      line++;
      lineStart = i;
      continue;
    }

    // strings (with optional prefixes)
    const pm = /^([rRbBuUfF]{0,2})(['"])/.exec(src.slice(i, i + 4));
    if (pm && (/^[rRbBuUfF]{0,2}$/.test(pm[1])) && (pm[1] === '' || !/[A-Za-z0-9_]/.test(src[i - 1] || ''))) {
      const prefix = pm[1].toLowerCase();
      if (prefix === '' || /^(r|b|u|f|rb|br|fr|rf)$/.test(prefix)) {
        const start = i;
        const startLine = line;
        let j = i + pm[1].length;
        const q = src[j];
        const triple = src.slice(j, j + 3) === q.repeat(3);
        const delim = triple ? q.repeat(3) : q;
        j += delim.length;
        const bodyStart = j;
        let closed = false;
        while (j < n) {
          if (src[j] === '\\') { if (src[j + 1] === '\n') { line++; lineStart = j + 2; } j += 2; continue; }
          if (src.startsWith(delim, j)) { closed = true; break; }
          if (src[j] === '\n') {
            if (!triple) break;
            line++;
            lineStart = j + 1;
          }
          j++;
        }
        if (!closed) {
          if (triple) err('unterminated triple-quoted string literal', startLine, start - (src.lastIndexOf('\n', start - 1) + 1) + 1);
          err('unterminated string literal', startLine, col);
        }
        const body = src.slice(bodyStart, j);
        j += delim.length;
        const raw = prefix.includes('r');
        const isF = prefix.includes('f');
        toks.push({
          type: isF ? 'fstring' : 'string',
          value: src.slice(start, j),
          line: startLine,
          col,
          start,
          end: j,
          str: isF ? body : raw ? body : unescape(body, file, startLine, col),
          raw,
        });
        i = j;
        continue;
      }
    }

    // numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?|\d[\d_]*\.)/.exec(src.slice(i));
      const text = m ? m[0] : ch;
      toks.push({ type: 'number', value: text, line, col, start: i, end: i + text.length });
      i += text.length;
      if (/[A-Za-z_]/.test(src[i] || '')) err('invalid decimal literal', line, col);
      continue;
    }

    // names
    if (/[A-Za-z_À-￿]/.test(ch)) {
      const m = /^[A-Za-z_À-￿][A-Za-z0-9_À-￿]*/.exec(src.slice(i))!;
      toks.push({ type: 'name', value: m[0], line, col, start: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }

    // operators
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      if (op === '(' || op === '[' || op === '{') depth++;
      else if (op === ')' || op === ']' || op === '}') {
        if (depth === 0) err(`unmatched '${op}'`, line, col);
        depth--;
      }
      toks.push({ type: 'op', value: op, line, col, start: i, end: i + op.length });
      i += op.length;
      continue;
    }
    if (ch === '`' ) err("invalid character '`' (U+0060)", line, col);
    if (ch === '$' || ch === '?' || ch === '!') err('invalid syntax', line, col);
    err(`invalid character '${ch}' (U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`, line, col);
  }
  if (depth > 0) {
    const open = [...toks].reverse().find((t) => t.type === 'op' && /[([{]/.test(t.value));
    err(`'${open?.value ?? '('}' was never closed`, open?.line ?? line, open?.col ?? 1);
  }
  const last = toks[toks.length - 1];
  if (last && last.type !== 'newline' && last.type !== 'dedent') toks.push({ type: 'newline', value: '', line, col: 1, start: n, end: n });
  while (indents.length > 1) {
    indents.pop();
    toks.push({ type: 'dedent', value: '', line, col: 1, start: n, end: n });
  }
  toks.push({ type: 'eof', value: '', line, col: 1, start: n, end: n });
  return toks;
}

export function unescape(s: string, file = '', line = 0, col = 0): string {
  if (!s.includes('\\')) return s;
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|N\{[^}]*\}|[0-7]{1,3}|\n|.)/g, (_, e: string) => {
    switch (e[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      case '\n': return '';
      case 'a': return '\x07';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case 'x': return String.fromCharCode(parseInt(e.slice(1), 16));
      case 'u': return String.fromCharCode(parseInt(e.slice(1), 16));
      case 'U': return String.fromCodePoint(parseInt(e.slice(1), 16));
      case 'N': throw new PySyntaxError('\\N{...} escapes are not supported in the emulator', file, line, col);
      default:
        if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
        return '\\' + e;
    }
  });
}
