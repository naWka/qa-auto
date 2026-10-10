// Locator parts and their resolution against a document.
import {
  accessibleName, elementText, getRole, headingLevel, isChecked, isDisabled, isHiddenForAria, isVisible, labelTexts,
} from './aria';
import { fmtOptions, fmtTextArg, normalizeWhitespace, quote } from './format';

export type TextArg = string | RegExp;

export interface RoleOptions {
  name?: TextArg;
  exact?: boolean;
  checked?: boolean;
  disabled?: boolean;
  level?: number;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean;
  includeHidden?: boolean;
}

export interface FilterOptions {
  hasText?: TextArg;
  hasNotText?: TextArg;
  has?: { _parts: Part[] };
  hasNot?: { _parts: Part[] };
  visible?: boolean;
}

export type Part =
  | { kind: 'css'; selector: string }
  | { kind: 'role'; role: string; opts: RoleOptions }
  | { kind: 'text'; text: TextArg; exact?: boolean }
  | { kind: 'label'; text: TextArg; exact?: boolean }
  | { kind: 'placeholder'; text: TextArg; exact?: boolean }
  | { kind: 'alt'; text: TextArg; exact?: boolean }
  | { kind: 'title'; text: TextArg; exact?: boolean }
  | { kind: 'testid'; id: TextArg }
  | { kind: 'nth'; index: number }
  | { kind: 'filter'; opts: FilterOptions }
  | { kind: 'and'; other: Part[] }
  | { kind: 'or'; other: Part[] };

/** Text matching like Playwright: default = case-insensitive substring; exact = case-sensitive full match. */
export function textMatcher(arg: TextArg, exact?: boolean): (s: string) => boolean {
  if (arg instanceof RegExp) {
    const re = new RegExp(arg.source, arg.flags.replace('g', ''));
    return (s) => re.test(normalizeWhitespace(s));
  }
  const want = normalizeWhitespace(arg);
  if (exact) return (s) => normalizeWhitespace(s) === want;
  const lower = want.toLowerCase();
  return (s) => normalizeWhitespace(s).toLowerCase().includes(lower);
}

function allElements(scope: Element | Document): Element[] {
  return Array.from(scope.querySelectorAll('*')).filter((e) => {
    const t = e.tagName.toLowerCase();
    return t !== 'script' && t !== 'style' && t !== 'head' && t !== 'meta' && t !== 'link' && t !== 'title' && t !== 'noscript';
  });
}

function sortDocumentOrder(list: Element[]): Element[] {
  const uniq = Array.from(new Set(list));
  return uniq.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    return pos & 4 ? -1 : pos & 2 ? 1 : 0;
  });
}

function matchText(el: Element, m: (s: string) => boolean): boolean {
  return m(elementText(el));
}

/** getByText: elements whose text matches, but not when the match comes entirely from a child element. */
function queryText(scope: Element | Document, arg: TextArg, exact?: boolean): Element[] {
  const m = textMatcher(arg, exact);
  const out: Element[] = [];
  for (const el of allElements(scope)) {
    if (el.tagName.toLowerCase() === 'html' || el.tagName.toLowerCase() === 'body') continue;
    if (!matchText(el, m)) continue;
    let childMatches = false;
    for (const c of Array.from(el.children)) {
      if (matchText(c, m)) { childMatches = true; break; }
    }
    if (!childMatches) out.push(el);
  }
  return out;
}

function queryRole(scope: Element | Document, role: string, o: RoleOptions): Element[] {
  const nameM = o.name !== undefined ? textMatcher(o.name, o.exact) : null;
  return allElements(scope).filter((el) => {
    if (getRole(el) !== role) return false;
    if (!o.includeHidden && isHiddenForAria(el)) return false;
    if (o.checked !== undefined) {
      const c = isChecked(el);
      if ((c === true) !== o.checked) return false;
    }
    if (o.disabled !== undefined && isDisabled(el) !== o.disabled) return false;
    if (o.level !== undefined && headingLevel(el) !== o.level) return false;
    if (o.expanded !== undefined && (el.getAttribute('aria-expanded') === 'true') !== o.expanded) return false;
    if (o.selected !== undefined) {
      const sel = el.tagName.toLowerCase() === 'option' ? (el as HTMLOptionElement).selected : el.getAttribute('aria-selected') === 'true';
      if (sel !== o.selected) return false;
    }
    if (o.pressed !== undefined && (el.getAttribute('aria-pressed') === 'true') !== o.pressed) return false;
    if (nameM && !nameM(accessibleName(el))) return false;
    return true;
  });
}

function queryAttr(scope: Element | Document, attr: string, arg: TextArg, exact?: boolean, tags?: RegExp): Element[] {
  const m = textMatcher(arg, exact);
  return allElements(scope).filter((el) => {
    if (tags && !tags.test(el.tagName.toLowerCase())) return false;
    const v = el.getAttribute(attr);
    return v !== null && m(v);
  });
}

function queryPart(scope: Element | Document, p: Part): Element[] {
  switch (p.kind) {
    case 'css': {
      const sel = p.selector.trim();
      if (sel.startsWith('//') || sel.startsWith('xpath=') || sel.startsWith('..')) {
        const expr = sel.replace(/^xpath=/, '');
        const doc = (scope as Element).ownerDocument || (scope as Document);
        const res = doc.evaluate(expr, scope, null, 7 /* ORDERED_NODE_SNAPSHOT_TYPE */, null);
        const out: Element[] = [];
        for (let i = 0; i < res.snapshotLength; i++) {
          const n = res.snapshotItem(i);
          if (n && n.nodeType === 1) out.push(n as Element);
        }
        return out;
      }
      if (sel.startsWith('text=')) return queryText(scope, sel.slice(5).replace(/^["']|["']$/g, ''), /^text=["']/.test(sel));
      try {
        return Array.from(scope.querySelectorAll(sel));
      } catch {
        throw new SyntaxError(`Unexpected token in selector "${p.selector}"`);
      }
    }
    case 'role': return queryRole(scope, p.role, p.opts);
    case 'text': return queryText(scope, p.text, p.exact);
    case 'label': {
      const m = textMatcher(p.text, p.exact);
      return allElements(scope).filter((el) => labelTexts(el).some((t) => m(t)));
    }
    case 'placeholder': return queryAttr(scope, 'placeholder', p.text, p.exact, /^(input|textarea)$/);
    case 'alt': return queryAttr(scope, 'alt', p.text, p.exact, /^(img|area|input)$/);
    case 'title': return queryAttr(scope, 'title', p.text, p.exact);
    case 'testid': return queryAttr(scope, 'data-testid', p.id, true);
    default: return [];
  }
}

export function resolveParts(doc: Document | null, parts: Part[]): Element[] {
  if (!doc || !doc.documentElement) return [];
  let current: (Element | Document)[] = [doc];
  let isRoot = true;
  for (const p of parts) {
    if (p.kind === 'nth') {
      const list = current as Element[];
      const i = p.index < 0 ? list.length + p.index : p.index;
      current = list[i] ? [list[i]] : [];
      continue;
    }
    if (p.kind === 'filter') {
      current = (current as Element[]).filter((el) => passesFilter(el, p.opts));
      continue;
    }
    if (p.kind === 'and') {
      const other = new Set(resolveParts(doc, p.other));
      current = (current as Element[]).filter((el) => other.has(el));
      continue;
    }
    if (p.kind === 'or') {
      current = sortDocumentOrder([...(current as Element[]), ...resolveParts(doc, p.other)]);
      continue;
    }
    const next: Element[] = [];
    for (const scope of current) next.push(...queryPart(scope, p));
    current = isRoot ? next : sortDocumentOrder(next);
    isRoot = false;
  }
  return isRoot ? [] : (current as Element[]);
}

function passesFilter(el: Element, o: FilterOptions): boolean {
  if (o.hasText !== undefined && !textMatcher(o.hasText)(elementText(el))) return false;
  if (o.hasNotText !== undefined && textMatcher(o.hasNotText)(elementText(el))) return false;
  if (o.has && !resolveWithin(el, o.has._parts).length) return false;
  if (o.hasNot && resolveWithin(el, o.hasNot._parts).length) return false;
  if (o.visible !== undefined && isVisible(el) !== o.visible) return false;
  return true;
}

function resolveWithin(root: Element, parts: Part[]): Element[] {
  let current: Element[] = [root];
  for (const p of parts) {
    if (p.kind === 'nth') {
      const i = p.index < 0 ? current.length + p.index : p.index;
      current = current[i] ? [current[i]] : [];
    } else if (p.kind === 'filter') current = current.filter((el) => passesFilter(el, p.opts));
    else if (p.kind === 'and' || p.kind === 'or') continue;
    else {
      const next: Element[] = [];
      for (const s of current) next.push(...queryPart(s, p));
      current = sortDocumentOrder(next);
    }
  }
  return current;
}

/** Playwright for Python description: get_by_role("button", name="Log in").first */
export function describeParts(parts: Part[]): string {
  const out: string[] = [];
  const kw = (exact?: boolean) => (exact ? ', exact=True' : '');
  for (const p of parts) {
    switch (p.kind) {
      case 'css': out.push(`locator(${quote(p.selector)})`); break;
      case 'role': {
        const o: Record<string, unknown> = {};
        if (p.opts.name !== undefined) o.name = p.opts.name;
        for (const k of ['exact', 'checked', 'disabled', 'level', 'expanded', 'selected', 'pressed', 'includeHidden'] as const) {
          if (p.opts[k] !== undefined) o[k] = p.opts[k];
        }
        const opts = fmtOptions(o);
        out.push(`get_by_role(${quote(p.role)}${opts ? ', ' + opts : ''})`);
        break;
      }
      case 'text': out.push(`get_by_text(${fmtTextArg(p.text)}${kw(p.exact)})`); break;
      case 'label': out.push(`get_by_label(${fmtTextArg(p.text)}${kw(p.exact)})`); break;
      case 'placeholder': out.push(`get_by_placeholder(${fmtTextArg(p.text)}${kw(p.exact)})`); break;
      case 'alt': out.push(`get_by_alt_text(${fmtTextArg(p.text)}${kw(p.exact)})`); break;
      case 'title': out.push(`get_by_title(${fmtTextArg(p.text)}${kw(p.exact)})`); break;
      case 'testid': out.push(`get_by_test_id(${fmtTextArg(p.id)})`); break;
      case 'nth': out.push(p.index === 0 ? 'first' : p.index === -1 ? 'last' : `nth(${p.index})`); break;
      case 'filter': {
        const o = p.opts;
        const items: string[] = [];
        if (o.hasText !== undefined) items.push(`has_text=${fmtTextArg(o.hasText)}`);
        if (o.hasNotText !== undefined) items.push(`has_not_text=${fmtTextArg(o.hasNotText)}`);
        if (o.has) items.push(`has=${describeParts(o.has._parts)}`);
        if (o.hasNot) items.push(`has_not=${describeParts(o.hasNot._parts)}`);
        if (o.visible !== undefined) items.push(`visible=${o.visible ? 'True' : 'False'}`);
        out.push(`filter(${items.join(', ')})`);
        break;
      }
      case 'and': out.push(`and_(${describeParts(p.other)})`); break;
      case 'or': out.push(`or_(${describeParts(p.other)})`); break;
    }
  }
  return out.join('.');
}
