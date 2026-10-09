// Simplified ARIA engine: implicit roles, accessible names, visibility.
// Mirrors the parts of Playwright's behaviour that matter for getByRole / getByLabel.
import { normalizeWhitespace } from './format';

const tag = (el: Element) => el.tagName.toLowerCase();
const style = (el: Element) => el.ownerDocument.defaultView!.getComputedStyle(el);

const INPUT_ROLES: Record<string, string | null> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox',
  email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox', '': 'textbox',
  password: null, hidden: null, file: null, color: null, date: null, 'datetime-local': null, month: null, time: null, week: null,
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
  const q = (s: string) => `'${s.replace(/'/g, "\\'")}'`;
  const role = getRole(el);
  const name = role ? accessibleName(el) : '';
  if (role && name && role !== 'paragraph' && role !== 'generic') {
    const short = name.length > 60 ? name.slice(0, 60) : name;
    return `getByRole(${q(role)}, { name: ${q(short)} })`;
  }
  const labels = labelTexts(el).filter(Boolean);
  if (labels.length) return `getByLabel(${q(labels[0])})`;
  const ph = el.getAttribute('placeholder');
  if (ph) return `getByPlaceholder(${q(ph)})`;
  const testId = el.getAttribute('data-testid');
  if (testId) return `getByTestId(${q(testId)})`;
  const alt = el.getAttribute('alt');
  if (alt) return `getByAltText(${q(alt)})`;
  const text = normalizeWhitespace(elementText(el));
  if (text && text.length <= 60) return `getByText(${q(text)})`;
  if (role) return `getByRole(${q(role)})`;
  if (el.id) return `locator(${q('#' + el.id)})`;
  return `locator(${q(tag(el))})`;
}
