// Simplified ARIA engine: implicit roles, accessible names, visibility.
// Mirrors the parts of Playwright's behaviour that matter for getByRole / getByLabel.
import { normalizeWhitespace } from './format';

const tag = (el: Element) => el.tagName.toLowerCase();
const style = (el: Element) => el.ownerDocument.defaultView!.getComputedStyle(el);

// Same mapping as Playwright's roleUtils: unknown types (password, date, …) fall back to textbox.
const INPUT_ROLES: Record<string, string | null> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button', file: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox',
  email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox', '': 'textbox', hidden: null,
};

const LANDMARK_CONTEXT = /^(article|aside|main|nav|section)$/;

export function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) {
    const first = explicit.trim().split(/\s+/)[0];
    if (first && first !== 'none' && first !== 'presentation') return first;
    if (first) return null;
  }
  const t = tag(el);
  switch (t) {
    case 'a': case 'area': return el.hasAttribute('href') ? 'link' : null;
    case 'button': return 'button';
    case 'input': {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if ((type === '' || type === 'text' || type === 'search' || type === 'email' || type === 'tel' || type === 'url') && el.hasAttribute('list')) return 'combobox';
      if (type === 'search' && el.hasAttribute('list')) return 'combobox';
      return type in INPUT_ROLES ? INPUT_ROLES[type] : 'textbox';
    }
    case 'textarea': return 'textbox';
    case 'select': return (el as HTMLSelectElement).multiple || Number(el.getAttribute('size')) > 1 ? 'listbox' : 'combobox';
    case 'option': return 'option';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'img': return el.getAttribute('alt') === '' && !el.getAttribute('title') ? 'presentation' : 'img';
    case 'ul': case 'ol': case 'menu': return 'list';
    case 'li': return 'listitem';
    case 'table': return 'table';
    case 'caption': return 'caption';
    case 'tr': return 'row';
    case 'td': return 'cell';
    case 'th': {
      const scope = el.getAttribute('scope');
      if (scope === 'row') return 'rowheader';
      if (scope === 'col' || el.closest('thead')) return 'columnheader';
      return 'columnheader';
    }
    case 'thead': case 'tbody': case 'tfoot': return 'rowgroup';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'aside': return 'complementary';
    case 'header': return hasLandmarkAncestor(el) ? null : 'banner';
    case 'footer': return hasLandmarkAncestor(el) ? null : 'contentinfo';
    case 'form': return hasAuthorName(el) ? 'form' : null;
    case 'section': return hasAuthorName(el) ? 'region' : null;
    case 'article': return 'article';
    case 'dialog': return 'dialog';
    case 'fieldset': return 'group';
    case 'details': return 'group';
    case 'summary': return 'button';
    case 'p': return 'paragraph';
    case 'dt': return 'term';
    case 'dd': return 'definition';
    case 'hr': return 'separator';
    case 'progress': return 'progressbar';
    case 'output': return 'status';
    case 'strong': case 'b': return 'strong';
    case 'em': case 'i': return 'emphasis';
    case 'blockquote': return 'blockquote';
    case 'code': return 'code';
    default: return null;
  }
}

function hasAuthorName(el: Element) {
  return !!(el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')?.trim() || el.getAttribute('title')?.trim());
}

function hasLandmarkAncestor(el: Element) {
  for (let p = el.parentElement; p; p = p.parentElement) if (LANDMARK_CONTEXT.test(tag(p))) return true;
  return false;
}

const NAME_FROM_CONTENT = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'radio', 'row', 'rowheader', 'switch', 'tab', 'tooltip', 'treeitem', 'caption', 'term',
]);

/** Elements hidden for assistive tech: display:none, visibility:hidden, hidden attr, aria-hidden. */
export function isHiddenForAria(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.getAttribute('aria-hidden') === 'true') return true;
    const s = style(e);
    if (s.display === 'none') return true;
    if (e === el && (s.visibility === 'hidden' || s.visibility === 'collapse')) return true;
  }
  return false;
}

/** Playwright's notion of visible: non-empty box and not visibility:hidden. */
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const s = style(el);
  if (s.visibility === 'hidden' || s.visibility === 'collapse') return false;
  if (s.display === 'contents') {
    for (const c of Array.from(el.children)) if (isVisible(c)) return true;
    return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function isDisabled(el: Element): boolean {
  const t = tag(el);
  if (/^(button|input|select|textarea|option|optgroup|fieldset)$/.test(t) && el.hasAttribute('disabled')) return true;
  if (/^(button|input|select|textarea)$/.test(t)) {
    const fs = el.closest('fieldset[disabled]');
    if (fs) {
      const legend = fs.querySelector(':scope > legend');
      if (!legend || !legend.contains(el)) return true;
    }
  }
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.getAttribute('aria-disabled') === 'true') return true;
  }
  return false;
}

export function isEditable(el: Element): boolean {
  if (isDisabled(el)) return false;
  if (el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true') return false;
  return true;
}

export function isChecked(el: Element): boolean | 'mixed' | undefined {
  const t = tag(el);
  if (t === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'checkbox' || type === 'radio') return (el as HTMLInputElement).checked;
  }
  const aria = el.getAttribute('aria-checked');
  if (aria === 'true') return true;
  if (aria === 'false') return false;
  if (aria === 'mixed') return 'mixed';
  return undefined;
}

/** Labels associated with a form control: <label for>, wrapping <label>. */
export function labelsOf(el: Element): Element[] {
  const result: Element[] = [];
  const t = tag(el);
  if (/^(input|select|textarea|button|meter|output|progress)$/.test(t)) {
    const labels = (el as HTMLInputElement).labels;
    if (labels) result.push(...Array.from(labels));
  }
  return result;
}

function textOfLabel(label: Element, control: Element): string {
  // Text of a label, excluding the control itself (and its options).
  let s = '';
  const walk = (n: Node) => {
    if (n === control) return;
    if (n.nodeType === 3) { s += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const t = tag(e);
    if (t === 'script' || t === 'style') return;
    if (t === 'select' || t === 'textarea') return;
    if (t === 'input') return;
    e.childNodes.forEach(walk);
  };
  label.childNodes.forEach(walk);
  return normalizeWhitespace(s);
}

/** Text used for name-from-content, skipping hidden subtrees; images contribute alt text. */
export function contentText(el: Element, depth = 0): string {
  let s = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) { s += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const t = tag(e);
    if (t === 'script' || t === 'style' || t === 'template') return;
    if (e.getAttribute('aria-hidden') === 'true') return;
    if (e.hasAttribute('hidden')) return;
    const st = style(e);
    if (st.display === 'none') return;
    const aria = e.getAttribute('aria-label');
    if (aria && aria.trim()) { s += ' ' + aria + ' '; return; }
    if (t === 'img') { s += ' ' + (e.getAttribute('alt') || '') + ' '; return; }
    if (t === 'input') {
      const type = (e as HTMLInputElement).type;
      if (type === 'button' || type === 'submit' || type === 'reset') s += ' ' + (e as HTMLInputElement).value + ' ';
      return;
    }
    const block = /^(div|p|li|h[1-6]|tr|td|th|section|article|br|dt|dd|ul|ol|table)$/.test(t);
    if (block) s += ' ';
    s += depth > 30 ? '' : contentText(e, depth + 1);
    if (block) s += ' ';
  });
  return s;
}

export function accessibleName(el: Element): string {
  return normalizeWhitespace(computeName(el));
}

function computeName(el: Element): string {
  const doc = el.ownerDocument;
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const parts = labelledby.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean) as Element[];
    if (parts.length) return parts.map((p) => normalizeWhitespace(contentText(p))).join(' ');
  }
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria;
  const t = tag(el);
  if (t === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'button' || type === 'submit' || type === 'reset') {
      return (el as HTMLInputElement).value || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '');
    }
    if (type === 'image') return el.getAttribute('alt') || el.getAttribute('title') || 'Submit';
  }
  if (/^(input|select|textarea)$/.test(t)) {
    const labels = labelsOf(el);
    if (labels.length) return labels.map((l) => textOfLabel(l, el)).join(' ');
    const title = el.getAttribute('title');
    if (title) return title;
    const ph = el.getAttribute('placeholder');
    if (ph) return ph;
    return '';
  }
  if (t === 'img') return el.getAttribute('alt') || el.getAttribute('title') || '';
  if (t === 'fieldset') {
    const legend = el.querySelector(':scope > legend');
    if (legend) return contentText(legend);
  }
  if (t === 'table') {
    const caption = el.querySelector(':scope > caption');
    if (caption) return contentText(caption);
  }
  const role = getRole(el);
  if (role && NAME_FROM_CONTENT.has(role)) {
    const text = contentText(el);
    if (normalizeWhitespace(text)) return text;
  }
  if (t === 'button') {
    const labels = labelsOf(el);
    if (labels.length) return labels.map((l) => textOfLabel(l, el)).join(' ');
  }
  return el.getAttribute('title') || '';
}

/** All label strings of an element for getByLabel: <label>, aria-labelledby, aria-label. */
export function labelTexts(el: Element): string[] {
  const out: string[] = [];
  const doc = el.ownerDocument;
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const parts = labelledby.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean) as Element[];
    if (parts.length) out.push(normalizeWhitespace(parts.map((p) => contentText(p)).join(' ')));
  }
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) out.push(normalizeWhitespace(aria));
  for (const l of labelsOf(el)) out.push(textOfLabel(l, el));
  return out;
}

/** Element's text as Playwright's text engine sees it. */
export function elementText(el: Element): string {
  const t = tag(el);
  if (t === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'button' || type === 'submit' || type === 'reset') return (el as HTMLInputElement).value;
  }
  let s = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) s += n.nodeValue;
    else if (n.nodeType === 1) {
      const tt = tag(n as Element);
      if (tt === 'script' || tt === 'style' || tt === 'template' || tt === 'head') return;
      s += elementText(n as Element);
    }
  });
  return s;
}

export function headingLevel(el: Element): number | undefined {
  const m = tag(el).match(/^h([1-6])$/);
  if (m) return Number(m[1]);
  const l = el.getAttribute('aria-level');
  return l ? Number(l) : undefined;
}

/** The best user-facing locator for an element, like Playwright's "aka" hints and codegen. */
export function suggestLocator(el: Element): string {
  const q = (s: string) => JSON.stringify(s);
  const role = getRole(el);
  const name = role ? accessibleName(el) : '';
  if (role && name && role !== 'paragraph' && role !== 'generic') {
    const short = name.length > 60 ? name.slice(0, 60) : name;
    return `get_by_role(${q(role)}, name=${q(short)})`;
  }
  const labels = labelTexts(el).filter(Boolean);
  if (labels.length) return `get_by_label(${q(labels[0])})`;
  const ph = el.getAttribute('placeholder');
  if (ph) return `get_by_placeholder(${q(ph)})`;
  const testId = el.getAttribute('data-testid');
  if (testId) return `get_by_test_id(${q(testId)})`;
  const alt = el.getAttribute('alt');
  if (alt) return `get_by_alt_text(${q(alt)})`;
  const text = normalizeWhitespace(elementText(el));
  if (text && text.length <= 60) return `get_by_text(${q(text)})`;
  if (role) return `get_by_role(${q(role)})`;
  if (el.id) return `locator(${q('#' + el.id)})`;
  return `locator(${q(tag(el))})`;
}

// ---------- accessibility snapshot (what an agent sees through Playwright MCP) ----------

export interface AriaNode {
  /** ARIA role, or 'text' for loose text */
  role: string;
  name: string;
  el: Element | null;
  /** [level=1], [checked], [disabled], [selected] */
  props: string[];
  /** inline value: text of a leaf, value of a field */
  value?: string;
  url?: string;
  placeholder?: string;
  ref?: string;
  children: AriaNode[];
}

const SKIP_TAGS = /^(script|style|template|noscript|head|meta|link)$/;
const TEXT_LEAF_ROLES = new Set(['paragraph', 'listitem', 'cell', 'strong', 'emphasis', 'caption', 'status', 'alert', 'term', 'definition', 'code', 'blockquote', 'columnheader', 'rowheader', 'rowgroup', 'generic']);
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);

function mergeText(nodes: AriaNode[]): AriaNode[] {
  const out: AriaNode[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.role === 'text' && prev?.role === 'text') prev.value = normalizeWhitespace(`${prev.value} ${n.value}`);
    else out.push(n);
  }
  return out.filter((n) => n.role !== 'text' || n.value);
}

/** Builds a simplified accessibility tree like Playwright's ariaSnapshot(): roles, names, states; generic containers are flattened.
 *  mcp: like Playwright MCP, also keep clickable elements without a role as `generic [cursor=pointer]`. */
export function ariaTree(root: Element, opts: { mcp?: boolean } = {}): AriaNode[] {
  let refs = 0;
  const visit = (node: Node): AriaNode[] => {
    if (node.nodeType === 3) {
      const text = normalizeWhitespace(node.nodeValue || '');
      return text ? [{ role: 'text', name: '', el: null, props: [], value: text, children: [] }] : [];
    }
    if (node.nodeType !== 1) return [];
    const el = node as Element;
    const t = tag(el);
    if (SKIP_TAGS.test(t)) return [];
    if (el.hasAttribute('data-preview-outline') || el.hasAttribute('data-emulator-overlay') || el.hasAttribute('data-inspector-overlay')) return [];
    if (el.hasAttribute('hidden') || isHiddenForAria(el)) return [];
    const role = getRole(el);
    const named = !!role && role !== 'presentation' && role !== 'none' && role !== 'generic';
    const clickable = !named && !!opts.mcp && style(el).cursor === 'pointer' && (!el.parentElement || style(el.parentElement).cursor !== 'pointer');
    const ref = named || clickable ? `e${++refs}` : undefined;
    let children: AriaNode[] = [];
    if (t === 'select') children = Array.from((el as HTMLSelectElement).options).flatMap(visit);
    else if (t !== 'input' && t !== 'textarea') el.childNodes.forEach((c) => { children.push(...visit(c)); });
    if (t === 'br') return [{ role: 'text', name: '', el: null, props: [], value: ' ', children: [] }];
    children = mergeText(children);
    if (clickable) {
      const g: AriaNode = { role: 'generic', name: '', el, props: ['cursor=pointer'], children, ref };
      if (children.length && children.every((c) => c.role === 'text')) { g.value = children.map((c) => c.value).join(' ').trim(); g.children = []; }
      return [g];
    }
    if (!named) return children;
    const n: AriaNode = { role: role!, name: accessibleName(el), el, props: [], children, ref };
    const level = role === 'heading' ? headingLevel(el) : undefined;
    if (level) n.props.push(`level=${level}`);
    const checked = isChecked(el);
    if (checked === true) n.props.push('checked');
    if (checked === 'mixed') n.props.push('checked=mixed');
    if (t === 'option' && (el as HTMLOptionElement).selected) n.props.push('selected');
    if (isDisabled(el)) n.props.push('disabled');
    if (VALUE_ROLES.has(role) && t !== 'select') {
      const v = (el as HTMLInputElement).value;
      if (v) n.value = v;
      const ph = el.getAttribute('placeholder');
      if (ph && ph !== n.name) n.placeholder = ph;
    }
    if (role === 'link') n.url = el.getAttribute('href') || undefined;
    // Text that only repeats the name is dropped; an unnamed leaf shows its text inline.
    if (n.children.length && n.children.every((c) => c.role === 'text')) {
      const text = n.children.map((c) => c.value).join(' ').trim();
      if (n.name && normalizeWhitespace(text) === n.name) n.children = [];
      else if (!n.name && TEXT_LEAF_ROLES.has(role)) { n.value = text; n.children = []; }
    }
    return [n];
  };
  return mergeText(Array.from(root.childNodes).flatMap(visit));
}

const yamlText = (s: string) => (/^[\s\-?:,[\]{}#&*!|>'"%@`]|: |:$|^\d+$/.test(s) ? JSON.stringify(s) : s);

/** One line of the snapshot, e.g. `- button "Log in" [ref=e14]` */
export function ariaLine(n: AriaNode, withRefs = false): string {
  if (n.role === 'text') return `- text: ${yamlText(n.value || '')}`;
  let s = `- ${n.role}`;
  if (n.name) s += ` ${JSON.stringify(n.name)}`;
  for (const p of n.props) if (!p.startsWith('cursor')) s += ` [${p}]`;
  if (withRefs && n.ref) s += ` [ref=${n.ref}]`;
  for (const p of n.props) if (p.startsWith('cursor')) s += ` [${p}]`;
  const hasKids = n.children.length > 0 || !!n.url || !!n.placeholder;
  if (n.value !== undefined && n.value !== '') s += `: ${VALUE_ROLES.has(n.role) ? JSON.stringify(n.value) : yamlText(n.value)}`;
  else if (hasKids) s += ':';
  return s;
}

/** Text form of the snapshot (YAML-like), as Playwright prints it. */
export function ariaSnapshot(root: Element, withRefs = false): string {
  const lines: string[] = [];
  const walk = (nodes: AriaNode[], depth: number) => {
    for (const n of nodes) {
      lines.push('  '.repeat(depth) + ariaLine(n, withRefs));
      if (n.url) lines.push('  '.repeat(depth + 1) + `- /url: ${n.url}`);
      if (n.placeholder) lines.push('  '.repeat(depth + 1) + `- /placeholder: ${n.placeholder}`);
      walk(n.children, depth + 1);
    }
  };
  walk(ariaTree(root), 0);
  return lines.join('\n');
}

// ---------- unique locator (like Playwright's "Pick locator") ----------

function sameLocatorCount(el: Element, loc: string): number {
  const doc = el.ownerDocument;
  const all = Array.from(doc.body.querySelectorAll('*')).filter((e) => !isHiddenForAria(e) || e === el);
  return all.filter((e) => suggestLocator(e) === loc).length;
}

const CONTAINERS: Array<{ match: (e: Element) => boolean; base: (e: Element) => string }> = [
  { match: (e) => getRole(e) === 'row', base: () => 'get_by_role("row")' },
  { match: (e) => !!e.getAttribute('data-testid') && /card|row|item/.test(e.getAttribute('data-testid')!), base: (e) => `get_by_test_id("${e.getAttribute('data-testid')}")` },
  { match: (e) => getRole(e) === 'listitem' || getRole(e) === 'article', base: (e) => `get_by_role("${getRole(e)}")` },
];

/** A locator that matches exactly this element: the suggested one, or scoped by its row / card via filter(has_text=…). */
export function uniqueLocator(el: Element): string {
  const base = suggestLocator(el);
  if (sameLocatorCount(el, base) <= 1) return base;
  for (let p = el.parentElement; p && p.tagName !== 'BODY'; p = p.parentElement) {
    const c = CONTAINERS.find((x) => x.match(p!));
    if (!c) continue;
    const label = p.querySelector('h1, h2, h3, td, th, [data-testid$="name"]');
    const text = normalizeWhitespace(label ? elementText(label) : '');
    if (!text) continue;
    return `${c.base(p)}.filter(has_text=${JSON.stringify(text)}).${base}`;
  }
  const same = Array.from(el.ownerDocument.body.querySelectorAll('*')).filter((e) => suggestLocator(e) === base);
  return `${base}.nth(${same.indexOf(el)})`;
}
