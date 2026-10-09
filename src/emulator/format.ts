// Formatting helpers that mimic Playwright's output.

export function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function fmtTextArg(t: string | RegExp): string {
  return t instanceof RegExp ? String(t) : quote(t);
}

export function fmtValue(v: unknown, depth = 0): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof RegExp) return String(v);
  if (typeof v === 'function') return '[Function]';
  if (typeof v === 'object' && v && typeof (v as { toString(): string }).toString === 'function' && (v as { __pwDescription?: string }).__pwDescription) {
    return (v as { __pwDescription: string }).__pwDescription;
  }
  if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
  if (Array.isArray(v)) return `[${v.map((x) => fmtValue(x, depth + 1)).join(', ')}]`;
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return '{}';
    return `{ ${entries.map(([k, x]) => `${/^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${fmtValue(x, depth + 1)}`).join(', ')} }`;
  }
  return String(v);
}

/** Options object as Playwright prints it in locator descriptions: { name: 'Log in', exact: true } */
export function fmtOptions(opts: Record<string, unknown> | undefined): string {
  if (!opts) return '';
  const entries = Object.entries(opts).filter(([, v]) => v !== undefined);
  if (!entries.length) return '';
  return `{ ${entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? quote(v) : v instanceof RegExp ? String(v) : String(v)}`).join(', ')} }`;
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/[​­]/g, '').replace(/\s+/g, ' ').trim();
}

/** `<button type="submit" class="btn">Log in</button>` — short element preview for call logs. */
export function previewElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'style') continue;
    if (attrs.length >= 5) { attrs.push('…'); break; }
    const v = a.value.length > 50 ? a.value.slice(0, 49) + '…' : a.value;
    attrs.push(v === '' ? a.name : `${a.name}="${v}"`);
  }
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  if (/^(input|img|br|hr|meta|link|area|source)$/.test(tag)) return open;
  let inner: string;
  if (el.children.length) inner = '…';
  else {
    const t = normalizeWhitespace(el.textContent || '');
    inner = t.length > 50 ? t.slice(0, 49) + '…' : t;
  }
  return `${open}${inner}</${tag}>`;
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
