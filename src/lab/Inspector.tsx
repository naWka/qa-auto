// A small DevTools-like inspector over the Bloomly iframe: the DOM tree ("Elements"),
// the accessibility snapshot an agent gets through Playwright MCP, and details of the selected element.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig } from '../content/schema';
import { BiInline, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { BrowserFrame } from './BrowserFrame';
import { AUT_DIR } from './useRunner';
import { BASE_URL, accessibleName, ariaLine, ariaTree, getRole, labelTexts, openPreview, outline, uniqueLocator, type AriaNode } from '../emulator';

export type InspectField = 'attributes' | 'role' | 'name' | 'locator';
export type InspectView = 'dom' | 'aria' | 'both';

const SKIP = /^(script|style|template|noscript)$/;
/** Roles that need an accessible name to be usable (WCAG 4.1.2); containers like alert or status don't. */
const NEEDS_NAME = /^(button|link|textbox|checkbox|radio|combobox|img|searchbox|spinbutton|slider|switch|tab|menuitem|option)$/;
const isOverlay = (el: Element) => el.hasAttribute('data-preview-outline') || el.hasAttribute('data-inspector-overlay') || el.hasAttribute('data-emulator-overlay');

/** Where the accessible name comes from — the part manual testers rarely see. */
export function nameSource(el: Element): { en: string; ru: string } | null {
  const t = el.tagName.toLowerCase();
  if (el.getAttribute('aria-labelledby')) return { en: 'aria-labelledby', ru: 'aria-labelledby' };
  if (el.getAttribute('aria-label')?.trim()) return { en: '`aria-label` attribute', ru: 'атрибут `aria-label`' };
  if (/^(input|select|textarea)$/.test(t)) {
    const type = (el as HTMLInputElement).type;
    if (t === 'input' && /^(button|submit|reset)$/.test(type)) return { en: '`value` attribute', ru: 'атрибут `value`' };
    if ((el as HTMLInputElement).labels?.length) return { en: '`<label>` element', ru: 'элемент `<label>`' };
    if (el.getAttribute('title')) return { en: '`title` attribute', ru: 'атрибут `title`' };
    if (el.getAttribute('placeholder')) return { en: '`placeholder` (weak!)', ru: '`placeholder` (ненадёжно!)' };
    return null;
  }
  if (t === 'img') return el.getAttribute('alt') ? { en: '`alt` attribute', ru: 'атрибут `alt`' } : null;
  if (t === 'fieldset') return { en: '`<legend>` element', ru: 'элемент `<legend>`' };
  if (t === 'table') return { en: '`<caption>` element', ru: 'элемент `<caption>`' };
  if (accessibleName(el)) return { en: 'text content', ru: 'текст внутри' };
  return null;
}

function shortValue(v: string) {
  if (v.startsWith('http') && v.includes('/aut/')) v = v.slice(v.indexOf('/aut/') + 5);
  return v.length > 48 ? `${v.slice(0, 30)}…${v.slice(-12)}` : v;
}

function OpenTag({ el, close }: { el: Element; close?: boolean }) {
  const t = el.tagName.toLowerCase();
  const attrs = Array.from(el.attributes).filter((a) => a.name !== 'data-trace-target');
  return (
    <span className="ins-tag">
      &lt;<span className="ins-tname">{t}</span>
      {attrs.map((a) => (
        <span key={a.name}> <span className="ins-aname">{a.name}</span>{a.value !== '' && <>=<span className="ins-aval">"{shortValue(a.value)}"</span></>}</span>
      ))}
      &gt;{close && <span className="ins-ellipsis">…&lt;/<span className="ins-tname">{t}</span>&gt;</span>}
    </span>
  );
}

function visibleChildren(el: Element): Node[] {
  return Array.from(el.childNodes).filter((n) => {
    if (n.nodeType === 3) return !!n.nodeValue?.trim();
    if (n.nodeType !== 1) return false;
    const e = n as Element;
    return !SKIP.test(e.tagName.toLowerCase()) && !isOverlay(e);
  });
}

interface TreeProps {
  node: Element;
  depth: number;
  open: Set<Element>;
  toggle: (el: Element) => void;
  selected: Element | null;
  select: (el: Element) => void;
  hover: (el: Element | null) => void;
}

function DomNode({ node, depth, open, toggle, selected, select, hover }: TreeProps) {
  const kids = visibleChildren(node);
  const t = node.tagName.toLowerCase();
  const onlyText = kids.length === 1 && kids[0].nodeType === 3 && (kids[0].nodeValue || '').trim().length <= 60;
  const isOpen = open.has(node);
  const rowRef = useRef<HTMLDivElement>(null);
  const isSel = selected === node;
  useEffect(() => { if (isSel) rowRef.current?.scrollIntoView({ block: 'nearest' }); }, [isSel]);
  return (
    <div className="ins-node">
      <div
        ref={rowRef}
        className={`ins-row ${isSel ? 'sel' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => select(node)}
        onMouseEnter={() => hover(node)}
        onMouseLeave={() => hover(null)}
      >
        {kids.length > 0 && !onlyText ? (
          <button type="button" className="ins-twisty" aria-label={isOpen ? 'collapse' : 'expand'} onClick={(e) => { e.stopPropagation(); toggle(node); }}>
            <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
        ) : <span className="ins-twisty" />}
        {onlyText ? (
          <span><OpenTag el={node} /><span className="ins-text">{(kids[0].nodeValue || '').trim()}</span>&lt;/<span className="ins-tname">{t}</span>&gt;</span>
        ) : <OpenTag el={node} close={kids.length > 0 && !isOpen} />}
      </div>
      {isOpen && !onlyText && (
        <>
          {kids.map((k, i) => k.nodeType === 3
            ? <div key={i} className="ins-row ins-textrow" style={{ paddingLeft: 20 + (depth + 1) * 14 }}>"{(k.nodeValue || '').trim().slice(0, 80)}"</div>
            : <DomNode key={i} node={k as Element} depth={depth + 1} open={open} toggle={toggle} selected={selected} select={select} hover={hover} />)}
          <div className="ins-row ins-close" style={{ paddingLeft: 20 + depth * 14 }}>&lt;/<span className="ins-tname">{t}</span>&gt;</div>
        </>
      )}
    </div>
  );
}

function AriaLines({ nodes, depth, selected, select, hover }: { nodes: AriaNode[]; depth: number; selected: Element | null; select: (el: Element) => void; hover: (el: Element | null) => void }) {
  return (
    <>
      {nodes.map((n, i) => (
        <AriaRow key={i} n={n} depth={depth} selected={selected} select={select} hover={hover} />
      ))}
    </>
  );
}

function AriaRow({ n, depth, selected, select, hover }: { n: AriaNode; depth: number; selected: Element | null; select: (el: Element) => void; hover: (el: Element | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const isSel = !!n.el && n.el === selected;
  useEffect(() => { if (isSel) ref.current?.scrollIntoView({ block: 'nearest' }); }, [isSel]);
  const pad = { paddingLeft: 8 + depth * 14 };
  return (
    <>
      <div
        ref={ref}
        className={`ins-row ins-aria ${n.el ? 'pickable' : ''} ${isSel ? 'sel' : ''} ${n.role !== 'text' && !n.name && NEEDS_NAME.test(n.role) ? 'unnamed' : ''}`}
        style={pad}
        onClick={() => n.el && select(n.el)}
        onMouseEnter={() => hover(n.el)}
        onMouseLeave={() => hover(null)}
      >
        {ariaLine(n, true)}
      </div>
      {n.url && <div className="ins-row ins-aria ins-prop" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>- /url: {n.url}</div>}
      {n.placeholder && <div className="ins-row ins-aria ins-prop" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>- /placeholder: {n.placeholder}</div>}
      <AriaLines nodes={n.children} depth={depth + 1} selected={selected} select={select} hover={hover} />
    </>
  );
}

export function ElementDetails({ el, show }: { el: Element; show: InspectField[] }) {
  const role = getRole(el);
  const realRole = role && role !== 'presentation' && role !== 'none' ? role : null;
  const name = realRole ? accessibleName(el) : '';
  const src = realRole ? nameSource(el) : null;
  const labels = labelTexts(el).filter(Boolean);
  const attrs = Array.from(el.attributes).filter((a) => a.name !== 'data-trace-target');
  return (
    <div className="ins-details">
      <div className="ins-dtag"><OpenTag el={el} /></div>
      <dl>
        {show.includes('attributes') && (
          <>
            <dt><U k="browser.attributes" stack={false} /></dt>
            <dd>{attrs.length ? attrs.map((a) => <code key={a.name} className="ins-attr">{a.name}{a.value !== '' ? `="${shortValue(a.value)}"` : ''}</code>) : <span className="muted">—</span>}</dd>
          </>
        )}
        {show.includes('role') && (
          <>
            <dt><U k="browser.role" stack={false} /></dt>
            <dd>{realRole ? <code>{realRole}</code> : <span className="muted"><BiInline t={{ en: 'none (generic container)', ru: 'нет (обычный контейнер)' }} stack={false} /></span>}</dd>
          </>
        )}
        {show.includes('name') && (
          <>
            <dt><U k="browser.name" stack={false} /></dt>
            <dd>
              {name ? <code>"{name}"</code> : realRole && NEEDS_NAME.test(realRole)
                ? <span className="ins-warn"><BiInline t={{ en: 'empty — screen readers and agents can’t tell what this is', ru: 'пустое — скринридер и агент не поймут, что это' }} stack={false} /></span>
                : <span className="muted">—</span>}
              {src && name && <span className="ins-src"> ← <BiInline t={src} stack={false} /></span>}
              {!realRole && labels.length > 0 && <span className="ins-src"> label: "{labels[0]}"</span>}
            </dd>
          </>
        )}
        {show.includes('locator') && (
          <>
            <dt><U k="browser.locator" stack={false} /></dt>
            <dd><code className="ins-locator">page.{uniqueLocator(el)}</code></dd>
          </>
        )}
      </dl>
    </div>
  );
}

export interface InspectorProps {
  app?: AppConfig;
  focus?: string;
  view?: InspectView;
  show?: InspectField[];
  /** called whenever the student selects an element */
  onSelect?: (el: Element | null) => void;
  /** externally forced selection (e.g. reveal the answer) */
  forceSelect?: string | null;
  locked?: boolean;
  height?: number;
  pickByDefault?: boolean;
}

export function Inspector({ app, focus, view = 'both', show = ['attributes', 'role', 'name', 'locator'], onSelect, forceSelect, locked, height = 320, pickByDefault = true }: InspectorProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Element | null>(null);
  const [tab, setTab] = useState<'dom' | 'aria'>(view === 'aria' ? 'aria' : 'dom');
  const [picking, setPicking] = useState(pickByDefault);
  const [open, setOpen] = useState<Set<Element>>(new Set());
  const [url, setUrl] = useState(BASE_URL + (app?.route || '/'));
  const hoverBox = useRef<HTMLDivElement | null>(null);
  const pickingRef = useRef(picking);
  pickingRef.current = picking && !locked;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const select = (el: Element | null, fromOutside = false) => {
    if (lockedRef.current && !fromOutside) return;
    setSelected(el);
    if (el) {
      setOpen((o) => {
        const n = new Set(o);
        for (let p = el.parentElement; p; p = p.parentElement) n.add(p);
        return n;
      });
      el.scrollIntoView({ block: 'nearest' });
    }
    const d = el?.ownerDocument;
    if (d) outline(d, el, el ? el.tagName.toLowerCase() : undefined);
    if (!fromOutside) onSelect?.(el);
  };

  const hover = (el: Element | null) => {
    const d = doc;
    if (!d) return;
    if (!hoverBox.current || !hoverBox.current.isConnected) {
      const b = d.createElement('div');
      b.setAttribute('data-inspector-overlay', '');
      b.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(117,89,196,.16);border:1px solid rgba(117,89,196,.7);border-radius:4px;display:none';
      d.body.appendChild(b);
      hoverBox.current = b;
    }
    const b = hoverBox.current;
    if (!el || !el.isConnected) { b.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(b.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };

  // load the app
  useEffect(() => {
    let alive = true;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!frame.current) return;
    openPreview(frame.current, AUT_DIR, { ...app, route: app?.route || '/' }).then((d) => {
      if (!alive || !d) return;
      setDoc(d);
      const bump = () => { clearTimeout(timer); timer = setTimeout(() => alive && setVersion((v) => v + 1), 120); };
      observer = new MutationObserver((records) => {
        if (records.every((r) => [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].every((n) => n.nodeType === 1 && isOverlay(n as Element)) && r.type === 'childList')) return;
        if (records.every((r) => r.type === 'attributes' && r.attributeName === 'data-trace-target')) return;
        bump();
      });
      observer.observe(d.body, { childList: true, subtree: true, attributes: true, characterData: true });
      const win = d.defaultView;
      win?.addEventListener('hashchange', () => setUrl(BASE_URL + (win.location.hash.slice(1) || '/')));
      // picking inside the page
      const onMove = (e: MouseEvent) => { if (pickingRef.current) hover(e.target as Element); };
      const onClick = (e: MouseEvent) => {
        if (!pickingRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        hover(null);
        select(e.target as Element);
      };
      d.addEventListener('mousemove', onMove, true);
      d.addEventListener('click', onClick, true);
      d.addEventListener('mouseleave', () => hover(null));
      const open0 = new Set<Element>([d.body]);
      const main = d.querySelector('main');
      if (main) open0.add(main);
      setOpen(open0);
      // wait a moment for async content (product list, orders) before selecting the focus element
      setTimeout(() => {
        if (!alive) return;
        const f = focus ? d.querySelector(focus) : null;
        if (f) select(f, true);
      }, 250);
    });
    return () => { alive = false; observer?.disconnect(); clearTimeout(timer); };
  }, [JSON.stringify(app), focus]);

  useEffect(() => {
    if (!doc || forceSelect === undefined || forceSelect === null) return;
    const el = doc.querySelector(forceSelect);
    if (el) select(el, true);
  }, [forceSelect, doc]);

  const toggle = (el: Element) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(el)) n.delete(el);
    else n.add(el);
    return n;
  });

  const aria = useMemo(() => (doc && tab === 'aria' ? ariaTree(doc.body, { mcp: true }) : []), [doc, version, tab]);
  const live = selected && selected.isConnected ? selected : null;

  const tabs: Array<'dom' | 'aria'> = view === 'both' ? ['dom', 'aria'] : [view];
  const pickBtn = (
    <button type="button" className={`ins-pick ${picking ? 'on' : ''}`} onClick={() => setPicking(!picking)} disabled={locked} title="Pick an element">
      <Icon name="inspect" size={15} /> <U k="browser.pick" stack={false} />
    </button>
  );

  return (
    <div className="inspector">
      <div className="ins-page">
        <BrowserFrame ref={frame} url={url} height={height} toolbar={pickBtn} className={picking && !locked ? 'picking' : ''} />
      </div>
      <div className="ins-panel">
        <div className="ins-tabs" role="tablist">
          {tabs.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {k === 'dom'
                ? <><Icon name="code" size={14} /> <BiInline t={{ en: 'Elements (DOM)', ru: 'Elements (DOM)' }} stack={false} /></>
                : <><Icon name="sparkle" size={14} /> <BiInline t={{ en: 'Agent’s view (snapshot)', ru: 'Взгляд агента' }} stack={false} /></>}
            </button>
          ))}
        </div>
        <div className="ins-tree" style={{ maxHeight: height - 20 }} data-version={version}>
          {!doc && <div className="ins-row muted">…</div>}
          {doc && tab === 'dom' && visibleChildren(doc.body).filter((n) => n.nodeType === 1).map((n, i) => (
            <DomNode key={`${i}-${version}`} node={n as Element} depth={0} open={open} toggle={toggle} selected={live} select={(e) => select(e)} hover={hover} />
          ))}
          {doc && tab === 'aria' && <AriaLines nodes={aria} depth={0} selected={live} select={(e) => select(e)} hover={hover} />}
        </div>
        {live && show.length > 0 && <ElementDetails el={live} show={show} />}
        {!live && <div className="ins-empty"><Icon name="inspect" size={15} /> <BiInline t={{ en: 'Click an element on the page or in the tree.', ru: 'Нажми на элемент на странице или в дереве.' }} stack={false} /></div>}
      </div>
    </div>
  );
}
