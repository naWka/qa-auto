// format(value, spec): the format-spec mini-language used by f-strings and str.format.
import { fmtFloat, repr, str, typeName } from './values';

interface ErrMaker { err(name: string, msg?: string): Error }

export function formatSpec(v: unknown, spec: string, ip: ErrMaker): string {
  if (!spec) return typeof v === 'string' ? v : str(v);
  const m = /^(?:(.)?([<>^=]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
  if (!m) throw ip.err('ValueError', `Invalid format specifier '${spec}' for object of type '${typeName(v)}'`);
  const [, fillCh, alignCh, sign, , zero, widthS, group, precS, type] = m;
  const width = widthS ? Number(widthS) : 0;
  const prec = precS !== undefined ? Number(precS) : undefined;
  let body: string;
  const isNum = typeof v === 'number' || typeof v === 'boolean';
  if (type && 'bcdeEfFgGnoxX%'.includes(type) && !isNum) {
    throw ip.err('ValueError', `Unknown format code '${type}' for object of type '${typeName(v)}'`);
  }
  if (isNum) {
    const n = Number(v);
    switch (type) {
      case 'd': case 'n':
        if (!Number.isInteger(n)) throw ip.err('ValueError', `Unknown format code 'd' for object of type 'float'`);
        body = String(Math.abs(n)); break;
      case 'f': case 'F': body = Math.abs(n).toFixed(prec ?? 6); break;
      case 'e': case 'E': body = Math.abs(n).toExponential(prec ?? 6).replace(/e([+-])(\d)$/, 'e$10$2'); if (type === 'E') body = body.toUpperCase(); break;
      case '%': body = (Math.abs(n) * 100).toFixed(prec ?? 6) + '%'; break;
      case 'x': body = Math.abs(n).toString(16); break;
      case 'X': body = Math.abs(n).toString(16).toUpperCase(); break;
      case 'b': body = Math.abs(n).toString(2); break;
      case 'o': body = Math.abs(n).toString(8); break;
      case 'g': case 'G': body = prec !== undefined ? String(Number(Math.abs(n).toPrecision(prec || 1))) : fmtFloat(Math.abs(n)); break;
      default: body = prec !== undefined ? Math.abs(n).toFixed(prec) : typeof v === 'boolean' ? (v ? 'True' : 'False') : fmtFloat(Math.abs(n));
    }
    if (group) {
      const [int, frac] = body.split('.');
      body = int.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (frac !== undefined ? '.' + frac : '');
    }
    const neg = n < 0 || Object.is(n, -0);
    const signStr = neg ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
    if (typeof v === 'boolean' && !type) body = v ? 'True' : 'False';
    if (zero && !alignCh) return signStr + body.padStart(Math.max(0, width - signStr.length), '0');
    body = signStr + body;
  } else {
    body = typeof v === 'string' ? v : v === null ? 'None' : str(v);
    if (prec !== undefined) body = body.slice(0, prec);
    if (type === 'r') body = repr(v);
  }
  if (body.length >= width) return body;
  const fill = fillCh ?? (zero ? '0' : ' ');
  const align = alignCh ?? (isNum ? '>' : '<');
  const pad = width - body.length;
  if (align === '<') return body + fill.repeat(pad);
  if (align === '>' || align === '=') return fill.repeat(pad) + body;
  const left = Math.floor(pad / 2);
  return fill.repeat(left) + body + fill.repeat(pad - left);
}
