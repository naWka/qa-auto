// Page and Locator: the student-facing Playwright API bound to the Bloomly iframe.
import { isChecked, isDisabled, isEditable, isVisible, suggestLocator } from './aria';
import { EmuError, callerLocation } from './errors';
import { fmtValue, previewElement, quote } from './format';
import { describeParts, resolveParts, type FilterOptions, type Part, type RoleOptions, type TextArg } from './selectors';
import { Pending, SPEC, type TestRuntime } from './runtime';

export const BASE_URL = 'http://localhost:3000';

export interface BloomlyCtx {
  config: { bugs: string[]; latency: Record<string, number | [number, number]>; cookieBanner?: boolean; variant?: string };
  storage: Record<string, string>;
  onNavigate?: (path: string) => void;
  onReady?: (win: Window) => void;
}

declare global {
  interface Window {
    __bloomlyCtx?: BloomlyCtx;
  }
}

export interface PageEnv {
  frame: HTMLIFrameElement;
  autUrl: string;
  ctx: BloomlyCtx;
  onUrl: (url: string) => void;
}

let navCounter = 0;

type Loc = { line: number; file: string } | undefined;
const here = (): Loc => callerLocation();

export class Page {
  _rt: TestRuntime;
  _env: PageEnv;
  _path: string | null = null;
  _history: string[] = [];
  _overlay: HTMLElement | null = null;
  keyboard: { press: (key: string) => Pending<void>; type: (text: string) => Pending<void> };

  constructor(rt: TestRuntime, env: PageEnv) {
    this._rt = rt;
    this._env = env;
    env.ctx.onNavigate = (path) => {
      if (this._path !== null && this._path !== path) this._history.push(this._path);
      this._path = path;
      env.onUrl(this.url());
    };
    this.keyboard = {
      press: (key: string) => {
        const loc = here();
        return rt.api(`Press "${key}"`, 'pw:api', loc, async () => {
          const doc = this._doc;
          const target = (doc?.activeElement as HTMLElement) || doc?.body;
          if (target) await pressKey(this, target, key);
        });
      },
      type: (text: string) => {
        const loc = here();
        return rt.api(`Type "${text}"`, 'pw:api', loc, async () => {
          const doc = this._doc;
          const target = doc?.activeElement as HTMLElement | null;
          if (target) await typeText(this, target, text, 0);
        });
      },
    };
  }

  get __pwDescription() {
    return 'page';
  }

  get _doc(): Document | null {
    if (this._path === null) return null;
    try {
      return this._env.frame.contentDocument;
    } catch {
      return null;
    }
  }

  get _win(): Window | null {
    return this._env.frame.contentWindow;
  }

  url(): string {
    return this._path === null ? 'about:blank' : BASE_URL + this._path;
  }

  _resolveUrl(url: string, method: string): string {
    let target: URL;
    try {
      target = new URL(url, BASE_URL);
    } catch {
      throw new EmuError('goto-invalid', `${method}: Protocol error (Page.navigate): Cannot navigate to invalid URL`, { url });
    }
    if (target.origin !== BASE_URL) {
      throw new EmuError('goto-external', `${method}: net::ERR_NAME_NOT_RESOLVED at ${target.href}`, { url: target.href }, { emulatorNote: true });
    }
    return target.pathname + target.search;
  }

  _load(path: string, pushHistory = true): Promise<void> {
    const rt = this._rt;
    if (pushHistory && this._path !== null) this._history.push(this._path);
    rt.checkAlive();
    const frame = this._env.frame;
    window.__bloomlyCtx = this._env.ctx;
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new EmuError('nav-timeout', `page.goto: Timeout ${rt.navigationTimeout}ms exceeded.`, { url: BASE_URL + path }));
      }, rt.navigationTimeout);
      this._env.ctx.onReady = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this._overlay = null;
        resolve();
      };
      this._path = null;
      const src = `${this._env.autUrl}?nav=${++navCounter}#${path}`;
      try {
        frame.contentWindow!.location.replace(src);
      } catch {
        frame.src = src;
      }
    });
  }

  goto(url: string, _opts?: unknown) {
    const loc = here();
    return this._rt.api(`Navigate to ${JSON.stringify(url)}`, 'pw:api', loc, async () => {
      const path = this._resolveUrl(url, 'page.goto');
      await this._rt.pace(`goto ${url}`, loc?.line);
      await this._load(path);
      return null;
    });
  }

  reload() {
    const loc = here();
    return this._rt.api('Reload', 'pw:api', loc, async () => {
      if (this._path === null) return null;
      await this._load(this._path, false);
      return null;
    });
  }

  goBack() {
    const loc = here();
    return this._rt.api('Go back', 'pw:api', loc, async () => {
      const prev = this._history.pop();
      if (!prev) return null;
      await this._load(prev, false);
      return null;
    });
  }

  title() {
    const loc = here();
    return this._rt.api('Get title', 'pw:api', loc, async () => this._doc?.title ?? '');
  }

  content() {
    const loc = here();
    return this._rt.api('Get content', 'pw:api', loc, async () => this._doc?.documentElement.outerHTML ?? '');
  }

  waitForTimeout(ms: number) {
    const loc = here();
    return this._rt.api(`Wait for timeout ${ms}ms`, 'pw:api', loc, async () => {
      await this._rt.sleep(ms);
    });
  }

  waitForLoadState(_state?: string) {
    const loc = here();
    return this._rt.api('Wait for load state', 'pw:api', loc, async () => {});
  }

  waitForURL(url: TextArg | ((u: URL) => boolean), opts: { timeout?: number } = {}) {
    const loc = here();
    return this._rt.api(`Wait for navigation to ${url instanceof RegExp ? String(url) : typeof url === 'function' ? 'predicate' : quote(url)}`, 'pw:api', loc, async () => {
      const timeout = opts.timeout ?? this._rt.navigationTimeout;
      const deadline = performance.now() + timeout;
      for (;;) {
        if (urlMatches(this.url(), url)) return;
        if (performance.now() > deadline) {
          throw new EmuError('wait-url-timeout', `page.waitForURL: Timeout ${timeout}ms exceeded.\n=========================== logs ===========================\nwaiting for navigation until "load"\n  navigated to "${this.url()}"\n============================================================`, { url: String(url), actual: this.url() });
        }
        await this._rt.sleep(100);
      }
    });
  }

  pause() {
    const loc = here();
    return this._rt.api('Pause', 'pw:api', loc, async () => {
      this._rt.ctl.setStepMode(true);
    });
  }

  screenshot() {
    const loc = here();
    return this._rt.api('Take screenshot', 'pw:api', loc, async () => {
      throw new EmuError('unsupported', 'page.screenshot is not available in the emulator', { method: 'page.screenshot' }, { emulatorNote: true });
    });
  }

  locator(selector: string, opts?: FilterOptions) {
    return new Locator(this, withFilter([{ kind: 'css', selector }], opts));
  }
  getByRole(role: string, opts: RoleOptions = {}) {
    return new Locator(this, [{ kind: 'role', role, opts: { ...opts } }]);
  }
  getByText(text: TextArg, opts: { exact?: boolean } = {}) {
    return new Locator(this, [{ kind: 'text', text, exact: opts.exact }]);
  }
  getByLabel(text: TextArg, opts: { exact?: boolean } = {}) {
    return new Locator(this, [{ kind: 'label', text, exact: opts.exact }]);
  }
  getByPlaceholder(text: TextArg, opts: { exact?: boolean } = {}) {
    return new Locator(this, [{ kind: 'placeholder', text, exact: opts.exact }]);
  }
  getByAltText(text: TextArg, opts: { exact?: boolean } = {}) {
    return new Locator(this, [{ kind: 'alt', text, exact: opts.exact }]);
  }
  getByTitle(text: TextArg, opts: { exact?: boolean } = {}) {
    return new Locator(this, [{ kind: 'title', text, exact: opts.exact }]);
  }
  getByTestId(id: TextArg) {
    return new Locator(this, [{ kind: 'testid', id }]);
  }

  // Shortcuts that real Playwright still supports (discouraged): page.click(selector) etc.
  click(selector: string) { return this.locator(selector)._act('click', 'page.click', here()); }
  fill(selector: string, value: string) { return this.locator(selector)._fill(value, 'page.fill', here()); }

  // ---- highlight overlay inside the app ----
  _highlight(el: Element, label: string) {
    const doc = el.ownerDocument;
    if (this._rt.ctl.trace) {
      doc.querySelectorAll('[data-trace-target]').forEach((n) => n.removeAttribute('data-trace-target'));
      el.setAttribute('data-trace-target', '');
      this._rt.ctl.emit({ type: 'highlight', label });
    }
    const r = el.getBoundingClientRect();
    let ov = this._overlay;
    if (!ov || ov.ownerDocument !== doc || !ov.isConnected) {
      ov = doc.createElement('div');
      ov.setAttribute('data-emulator-overlay', '');
      ov.setAttribute('aria-hidden', 'true');
      ov.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #d9668f;background:rgba(232,155,180,.22);border-radius:6px;transition:all .15s ease;box-shadow:0 0 0 4px rgba(217,102,143,.18)';
      const tag = doc.createElement('div');
      tag.style.cssText = 'position:absolute;left:-2px;bottom:100%;margin-bottom:4px;background:#5b3f73;color:#fff;font:600 11px/1.3 ui-monospace,Menlo,monospace;padding:3px 7px;border-radius:6px;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis';
      ov.appendChild(tag);
      doc.body.appendChild(ov);
      this._overlay = ov;
    }
    ov.style.left = `${r.left - 3}px`;
    ov.style.top = `${r.top - 3}px`;
    ov.style.width = `${r.width + 6}px`;
    ov.style.height = `${r.height + 6}px`;
    ov.style.display = 'block';
    const tag = ov.firstChild as HTMLElement;
    tag.textContent = label;
    if (r.top < 24) { tag.style.bottom = 'auto'; tag.style.top = '100%'; tag.style.marginTop = '4px'; } else { tag.style.top = 'auto'; tag.style.bottom = '100%'; }
  }
  _hideHighlight() {
    if (this._overlay && this._overlay.isConnected) this._overlay.style.display = 'none';
  }
}

function urlMatches(actual: string, expected: TextArg | ((u: URL) => boolean)): boolean {
  if (typeof expected === 'function') return expected(new URL(actual));
  if (expected instanceof RegExp) return expected.test(actual);
  try {
    return new URL(expected, BASE_URL).href === actual;
  } catch {
    return false;
  }
}

function withFilter(parts: Part[], opts?: FilterOptions): Part[] {
  if (opts && Object.keys(opts).length) return [...parts, { kind: 'filter', opts }];
  return parts;
}

type WaitState = 'attached' | 'visible' | 'enabled' | 'editable';

export class Locator {
  _page: Page;
  _parts: Part[];

  constructor(page: Page, parts: Part[]) {
    this._page = page;
    this._parts = parts;
  }

  get __pwDescription() {
    return describeParts(this._parts);
  }
  toString() {
    return `locator(${describeParts(this._parts)})`;
  }

  _resolve(): Element[] {
    return resolveParts(this._page._doc, this._parts);
  }

  // ---- refinement ----
  locator(selector: string | Locator, opts?: FilterOptions) {
    if (selector instanceof Locator) return new Locator(this._page, withFilter([...this._parts, ...selector._parts], opts));
    return new Locator(this._page, withFilter([...this._parts, { kind: 'css', selector }], opts));
  }
  getByRole(role: string, opts: RoleOptions = {}) { return new Locator(this._page, [...this._parts, { kind: 'role', role, opts: { ...opts } }]); }
  getByText(text: TextArg, opts: { exact?: boolean } = {}) { return new Locator(this._page, [...this._parts, { kind: 'text', text, exact: opts.exact }]); }
  getByLabel(text: TextArg, opts: { exact?: boolean } = {}) { return new Locator(this._page, [...this._parts, { kind: 'label', text, exact: opts.exact }]); }
  getByPlaceholder(text: TextArg, opts: { exact?: boolean } = {}) { return new Locator(this._page, [...this._parts, { kind: 'placeholder', text, exact: opts.exact }]); }
  getByAltText(text: TextArg, opts: { exact?: boolean } = {}) { return new Locator(this._page, [...this._parts, { kind: 'alt', text, exact: opts.exact }]); }
  getByTitle(text: TextArg, opts: { exact?: boolean } = {}) { return new Locator(this._page, [...this._parts, { kind: 'title', text, exact: opts.exact }]); }
  getByTestId(id: TextArg) { return new Locator(this._page, [...this._parts, { kind: 'testid', id }]); }
  first() { return new Locator(this._page, [...this._parts, { kind: 'nth', index: 0 }]); }
  last() { return new Locator(this._page, [...this._parts, { kind: 'nth', index: -1 }]); }
  nth(index: number) { return new Locator(this._page, [...this._parts, { kind: 'nth', index }]); }
  filter(opts: FilterOptions = {}) { return new Locator(this._page, withFilter(this._parts, opts)); }
  and(other: Locator) { return new Locator(this._page, [...this._parts, { kind: 'and', other: other._parts }]); }
  or(other: Locator) { return new Locator(this._page, [...this._parts, { kind: 'or', other: other._parts }]); }

  get page() {
    return this._page;
  }

  // ---- waiting ----
  _strictError(method: string, els: Element[]): EmuError {
    const desc = describeParts(this._parts);
    const lines = els.slice(0, 10).map((el, i) => `    ${i + 1}) ${previewElement(el)} aka ${suggestLocator(el)}`);
    if (els.length > 10) lines.push(`    ...and ${els.length - 10} more`);
    return new EmuError(
      'strict-mode',
      `${method}: Error: strict mode violation: ${desc} resolved to ${els.length} elements:\n${lines.join('\n')}\n\nCall log:\n  - waiting for ${desc}`,
      { locator: desc, count: els.length, method },
    );
  }

  async _waitFor(method: string, state: WaitState, opts: { timeout?: number; force?: boolean; hitTest?: boolean } = {}): Promise<Element> {
    const rt = this._page._rt;
    const timeout = opts.timeout ?? rt.actionTimeout;
    const deadline = performance.now() + timeout;
    const desc = describeParts(this._parts);
    const log: string[] = [`  - waiting for ${desc}`];
    let lastProblem = '';
    for (;;) {
      rt.checkAlive();
      const els = this._resolve();
      if (els.length > 1) throw this._strictError(method, els);
      if (els.length === 1) {
        const el = els[0];
        let problem = '';
        if (state !== 'attached' && !opts.force) {
          if (!isVisible(el)) problem = 'element is not visible';
          else if ((state === 'enabled' || state === 'editable') && isDisabled(el)) problem = 'element is not enabled';
          else if (state === 'editable' && !isEditable(el)) problem = 'element is not editable';
          else if (opts.hitTest) {
            scrollIntoView(el);
            const blocker = hitTarget(el);
            if (blocker) problem = `${previewElement(blocker)} intercepts pointer events`;
          }
        }
        if (!problem) return el;
        if (problem !== lastProblem) {
          log.push(`  - locator resolved to ${previewElement(el)}`, `  - ${problem}`, '  - retrying…');
          lastProblem = problem;
        }
      }
      if (performance.now() > deadline) {
        const reason = lastProblem || 'element not found';
        throw new EmuError(
          lastProblem ? 'action-not-actionable' : 'action-timeout',
          `${method}: Timeout ${timeout}ms exceeded.\nCall log:\n${log.join('\n')}`,
          { method, locator: desc, reason, timeout },
        );
      }
      await rt.sleep(100);
    }
  }

  async _prepare(method: string, el: Element, label: string, loc: Loc) {
    const page = this._page;
    scrollIntoView(el);
    page._highlight(el, label);
    await page._rt.pace(`${method} ${label}`, loc?.line);
  }

  _act(kind: 'click' | 'dblclick' | 'hover' | 'focus', method: string, loc: Loc, opts: { timeout?: number; force?: boolean } = {}) {
    const desc = describeParts(this._parts);
    const titles = { click: 'Click', dblclick: 'Double click', hover: 'Hover', focus: 'Focus' };
    return this._page._rt.api(`${titles[kind]} ${desc}`, 'pw:api', loc, async () => {
      const el = await this._waitFor(method, kind === 'focus' ? 'visible' : 'enabled', { ...opts, hitTest: kind !== 'focus' && !opts.force });
      await this._prepare(method, el, desc, loc);
      const h = el as HTMLElement;
      if (kind === 'hover') { mouse(h, 'pointerover'); mouse(h, 'mouseover'); mouse(h, 'mouseenter', false); mouse(h, 'mousemove'); }
      else if (kind === 'focus') h.focus();
      else {
        const times = kind === 'dblclick' ? 2 : 1;
        for (let i = 0; i < times; i++) {
          mouse(h, 'pointerdown'); mouse(h, 'mousedown');
          if (typeof h.focus === 'function') h.focus();
          mouse(h, 'pointerup'); mouse(h, 'mouseup');
          h.click();
        }
        if (kind === 'dblclick') mouse(h, 'dblclick');
      }
      await settle(this._page);
      this._page._hideHighlight();
    });
  }

  click(opts?: { timeout?: number; force?: boolean }) { return this._act('click', 'locator.click', here(), opts); }
  dblclick(opts?: { timeout?: number; force?: boolean }) { return this._act('dblclick', 'locator.dblclick', here(), opts); }
  hover(opts?: { timeout?: number; force?: boolean }) { return this._act('hover', 'locator.hover', here(), opts); }
  focus(opts?: { timeout?: number }) { return this._act('focus', 'locator.focus', here(), opts); }

  _fill(value: string, method: string, loc: Loc, opts: { timeout?: number } = {}) {
    const desc = describeParts(this._parts);
    return this._page._rt.api(`Fill ${fmtValue(value)} ${desc}`, 'pw:api', loc, async () => {
      if (typeof value !== 'string') {
        throw new EmuError('fill-not-string', `${method}: value: expected string, got ${typeof value}`, { got: typeof value });
      }
      let el = await this._waitFor(method, 'editable', opts);
      el = retarget(el);
      const t = el.tagName.toLowerCase();
      const type = t === 'input' ? (el as HTMLInputElement).type : '';
      const isText = (t === 'input' && !/^(checkbox|radio|file|submit|button|reset|image|range|color|hidden)$/.test(type)) || t === 'textarea' || (el as HTMLElement).isContentEditable;
      if (!isText) {
        if (t === 'input') throw new EmuError('not-input', `${method}: Error: Input of type "${type}" cannot be filled\nCall log:\n  - waiting for ${desc}\n  - locator resolved to ${previewElement(el)}`, { locator: desc, element: previewElement(el) });
        throw new EmuError('not-input', `${method}: Error: Element is not an <input>, <textarea> or [contenteditable] element\nCall log:\n  - waiting for ${desc}\n  - locator resolved to ${previewElement(el)}`, { locator: desc, element: previewElement(el) });
      }
      if (type === 'number' && value.trim() !== '' && isNaN(Number(value))) {
        throw new EmuError('fill-number', `${method}: Error: Cannot type text into input[type=number]`, { value });
      }
      if (/^(date|time|datetime-local|month|week)$/.test(type) && value !== '') {
        const formats: Record<string, RegExp> = { date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}(:\d{2})?$/, 'datetime-local': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, month: /^\d{4}-\d{2}$/, week: /^\d{4}-W\d{2}$/ };
        if (!formats[type].test(value)) throw new EmuError('fill-date', `${method}: Error: Malformed value`, { value, type });
      }
      await this._prepare(method, el, desc, loc);
      const h = el as HTMLInputElement;
      h.focus();
      if (h.isContentEditable) h.textContent = value;
      else setNativeValue(h, value);
      dispatch(h, 'input', { inputType: 'insertText', data: value });
      dispatch(h, 'change');
      await settle(this._page);
      this._page._hideHighlight();
    });
  }

  fill(value: string, opts?: { timeout?: number }) { return this._fill(value, 'locator.fill', here(), opts); }
  clear(opts?: { timeout?: number }) { return this._fill('', 'locator.clear', here(), opts); }

  pressSequentially(text: string, opts: { delay?: number; timeout?: number } = {}) {
    const loc = here();
    const desc = describeParts(this._parts);
    return this._page._rt.api(`Type ${fmtValue(text)} ${desc}`, 'pw:api', loc, async () => {
      const el = retarget(await this._waitFor('locator.pressSequentially', 'editable', opts));
      await this._prepare('locator.pressSequentially', el, desc, loc);
      (el as HTMLElement).focus();
      await typeText(this._page, el as HTMLElement, text, opts.delay ?? 0);
      this._page._hideHighlight();
    });
  }
  type(text: string, opts?: { delay?: number; timeout?: number }) { return this.pressSequentially(text, opts); }

  press(key: string, opts: { timeout?: number } = {}) {
    const loc = here();
    const desc = describeParts(this._parts);
    return this._page._rt.api(`Press "${key}" ${desc}`, 'pw:api', loc, async () => {
      const el = await this._waitFor('locator.press', 'visible', opts);
      await this._prepare('locator.press', el, desc, loc);
      (el as HTMLElement).focus();
      await pressKey(this._page, el as HTMLElement, key);
      this._page._hideHighlight();
    });
  }

  _setChecked(checked: boolean, method: string, loc: Loc, opts: { timeout?: number; force?: boolean } = {}) {
    const desc = describeParts(this._parts);
    return this._page._rt.api(`${checked ? 'Check' : 'Uncheck'} ${desc}`, 'pw:api', loc, async () => {
      let el = await this._waitFor(method, 'enabled', { ...opts, hitTest: false });
      el = retarget(el);
      const state = isChecked(el);
      if (state === undefined) {
        throw new EmuError('not-checkbox', `${method}: Error: Not a checkbox or radio button\nCall log:\n  - waiting for ${desc}\n  - locator resolved to ${previewElement(el)}`, { locator: desc, element: previewElement(el) });
      }
      if (state === checked) return;
      if (!checked && el.tagName.toLowerCase() === 'input' && (el as HTMLInputElement).type === 'radio') {
        throw new EmuError('uncheck-radio', `${method}: Error: Cannot uncheck radio button. Radio buttons can only be unchecked by selecting another radio button in the same group.`, { locator: desc });
      }
      await this._prepare(method, el, desc, loc);
      const h = el as HTMLElement;
      mouse(h, 'pointerdown'); mouse(h, 'mousedown'); h.focus(); mouse(h, 'pointerup'); mouse(h, 'mouseup');
      h.click();
      await settle(this._page);
      if (isChecked(el) !== checked) throw new EmuError('check-no-effect', `${method}: Error: Clicking the checkbox did not change its state`, { locator: desc });
      this._page._hideHighlight();
    });
  }
  check(opts?: { timeout?: number; force?: boolean }) { return this._setChecked(true, 'locator.check', here(), opts); }
  uncheck(opts?: { timeout?: number; force?: boolean }) { return this._setChecked(false, 'locator.uncheck', here(), opts); }
  setChecked(checked: boolean, opts?: { timeout?: number; force?: boolean }) { return this._setChecked(checked, 'locator.setChecked', here(), opts); }

  selectOption(values: unknown, opts: { timeout?: number } = {}) {
    const loc = here();
    const desc = describeParts(this._parts);
    return this._page._rt.api(`Select option ${fmtValue(values)} ${desc}`, 'pw:api', loc, async () => {
      const rt = this._page._rt;
      const timeout = opts.timeout ?? rt.actionTimeout;
      const deadline = performance.now() + timeout;
      let el = retarget(await this._waitFor('locator.selectOption', 'enabled', { timeout }));
      if (el.tagName.toLowerCase() !== 'select') {
        throw new EmuError('not-select', `locator.selectOption: Error: Element is not a <select> element\nCall log:\n  - waiting for ${desc}\n  - locator resolved to ${previewElement(el)}`, { locator: desc, element: previewElement(el) });
      }
      const select = el as HTMLSelectElement;
      const wanted = (Array.isArray(values) ? values : [values]) as unknown[];
      for (;;) {
        const options = Array.from(select.options);
        const picked: HTMLOptionElement[] = [];
        let missing = false;
        for (const w of wanted) {
          const o = options.find((opt) => {
            if (typeof w === 'string') return opt.value === w || opt.label === w || opt.text.trim() === w;
            if (w && typeof w === 'object') {
              const ww = w as { value?: string; label?: string; index?: number };
              if (ww.value !== undefined && opt.value !== ww.value) return false;
              if (ww.label !== undefined && opt.label !== ww.label && opt.text.trim() !== ww.label) return false;
              if (ww.index !== undefined && opt.index !== ww.index) return false;
              return true;
            }
            return false;
          });
          if (!o) missing = true;
          else picked.push(o);
        }
        if (!missing) {
          await this._prepare('locator.selectOption', select, desc, loc);
          options.forEach((o) => { o.selected = picked.includes(o); });
          if (!select.multiple && picked[0]) select.value = picked[0].value;
          dispatch(select, 'input');
          dispatch(select, 'change');
          await settle(this._page);
          this._page._hideHighlight();
          return picked.map((o) => o.value);
        }
        if (performance.now() > deadline) {
          const available = options.map((o) => `"${o.text.trim()}"`).join(', ');
          throw new EmuError('select-missing', `locator.selectOption: Timeout ${timeout}ms exceeded.\nCall log:\n  - waiting for ${desc}\n  - locator resolved to ${previewElement(select)}\n  - did not find some options (${fmtValue(values)}). Available: ${available}`, { locator: desc, value: fmtValue(values), available });
        }
        await rt.sleep(100);
        el = retarget(await this._waitFor('locator.selectOption', 'enabled', { timeout }));
      }
    });
  }

  // ---- queries ----
  _query<T>(title: string, method: string, state: WaitState, fn: (el: Element) => T, opts: { timeout?: number } = {}) {
    const loc = here();
    return this._page._rt.api(`${title} ${describeParts(this._parts)}`, 'pw:api', loc, async () => fn(await this._waitFor(method, state, opts)));
  }
  textContent(opts?: { timeout?: number }) { return this._query('Get text content', 'locator.textContent', 'attached', (el) => el.textContent, opts); }
  innerText(opts?: { timeout?: number }) { return this._query('Get inner text', 'locator.innerText', 'attached', (el) => (el as HTMLElement).innerText, opts); }
  innerHTML(opts?: { timeout?: number }) { return this._query('Get inner HTML', 'locator.innerHTML', 'attached', (el) => el.innerHTML, opts); }
  getAttribute(name: string, opts?: { timeout?: number }) { return this._query(`Get attribute "${name}"`, 'locator.getAttribute', 'attached', (el) => el.getAttribute(name), opts); }
  inputValue(opts?: { timeout?: number }) {
    return this._query('Get input value', 'locator.inputValue', 'attached', (el) => {
      el = retarget(el);
      const t = el.tagName.toLowerCase();
      if (t !== 'input' && t !== 'textarea' && t !== 'select') throw new EmuError('not-input', 'locator.inputValue: Error: Node is not an <input>, <textarea> or <select> element', { element: previewElement(el) });
      return (el as HTMLInputElement).value;
    }, opts);
  }

  _instant<T>(title: string, method: string, fn: (els: Element[]) => T, strict = true) {
    const loc = here();
    return this._page._rt.api(`${title} ${describeParts(this._parts)}`, 'pw:api', loc, async () => {
      const els = this._resolve();
      if (strict && els.length > 1) throw this._strictError(method, els);
      return fn(els);
    });
  }
  isVisible() { return this._instant('Is visible', 'locator.isVisible', (els) => !!els[0] && isVisible(els[0])); }
  isHidden() { return this._instant('Is hidden', 'locator.isHidden', (els) => !els[0] || !isVisible(els[0])); }
  isEnabled() { return this._instant('Is enabled', 'locator.isEnabled', (els) => !!els[0] && !isDisabled(els[0])); }
  isDisabled() { return this._instant('Is disabled', 'locator.isDisabled', (els) => !!els[0] && isDisabled(els[0])); }
  isEditable() { return this._instant('Is editable', 'locator.isEditable', (els) => !!els[0] && isEditable(els[0])); }
  isChecked() {
    return this._instant('Is checked', 'locator.isChecked', (els) => {
      const el = els[0] ? retarget(els[0]) : undefined;
      if (!el) throw new EmuError('action-timeout', 'locator.isChecked: element not found', { locator: describeParts(this._parts) });
      const c = isChecked(el);
      if (c === undefined) throw new EmuError('not-checkbox', 'locator.isChecked: Error: Not a checkbox or radio button', { locator: describeParts(this._parts) });
      return c === true;
    });
  }
  count() { return this._instant('Count', 'locator.count', (els) => els.length, false); }
  all() { return this._instant('All', 'locator.all', (els) => els.map((_, i) => this.nth(i)), false); }
  allTextContents() { return this._instant('All text contents', 'locator.allTextContents', (els) => els.map((e) => e.textContent || ''), false); }
  allInnerTexts() { return this._instant('All inner texts', 'locator.allInnerTexts', (els) => els.map((e) => (e as HTMLElement).innerText), false); }

  waitFor(opts: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number } = {}) {
    const loc = here();
    const state = opts.state ?? 'visible';
    const desc = describeParts(this._parts);
    return this._page._rt.api(`Wait for ${desc} to be ${state}`, 'pw:api', loc, async () => {
      const rt = this._page._rt;
      const timeout = opts.timeout ?? rt.actionTimeout;
      const deadline = performance.now() + timeout;
      for (;;) {
        rt.checkAlive();
        const els = this._resolve();
        if (els.length > 1 && (state === 'visible' || state === 'attached')) throw this._strictError('locator.waitFor', els);
        const el = els[0];
        const ok = state === 'attached' ? !!el : state === 'detached' ? !el : state === 'visible' ? !!el && isVisible(el) : !el || !isVisible(el);
        if (ok) return;
        if (performance.now() > deadline) {
          throw new EmuError('wait-timeout', `locator.waitFor: Timeout ${timeout}ms exceeded.\nCall log:\n  - waiting for ${desc} to be ${state}`, { locator: desc, state, timeout });
        }
        await rt.sleep(100);
      }
    });
  }

  scrollIntoViewIfNeeded() {
    const loc = here();
    return this._page._rt.api(`Scroll into view ${describeParts(this._parts)}`, 'pw:api', loc, async () => {
      scrollIntoView(await this._waitFor('locator.scrollIntoViewIfNeeded', 'visible'));
    });
  }

  evaluate() {
    const loc = here();
    return this._page._rt.api('Evaluate', 'pw:api', loc, async () => {
      throw new EmuError('unsupported', 'locator.evaluate is not available in the emulator', { method: 'locator.evaluate' }, { emulatorNote: true });
    });
  }
}

// ---------- DOM helpers (operate inside the iframe realm) ----------

function retarget(el: Element): Element {
  if (el.tagName.toLowerCase() === 'label') {
    const control = (el as HTMLLabelElement).control;
    if (control) return control;
  }
  return el;
}

function scrollIntoView(el: Element) {
  const win = el.ownerDocument.defaultView;
  if (!win) return;
  const r = el.getBoundingClientRect();
  const vh = win.innerHeight;
  const vw = win.innerWidth;
  let dy = 0;
  let dx = 0;
  if (r.top < 0 || r.bottom > vh) dy = r.top - vh / 2 + r.height / 2;
  if (r.left < 0 || r.right > vw) dx = r.left - vw / 2 + r.width / 2;
  if (dx || dy) win.scrollBy(dx, dy);
}

/** Returns the element that would receive a click at the centre of `el`, if it's not `el` itself. */
function hitTarget(el: Element): Element | null {
  const doc = el.ownerDocument;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const win = doc.defaultView!;
  if (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) return null;
  const hit = doc.elementFromPoint(x, y);
  if (!hit || hit === el || el.contains(hit) || hit.hasAttribute('data-emulator-overlay')) return null;
  // a <label> wrapping or pointing at the target forwards the click
  const label = hit.closest('label');
  if (label && ((label as HTMLLabelElement).control === el || label.contains(el))) return null;
  return hit;
}

function mouse(el: HTMLElement, type: string, bubbles = true) {
  const win = el.ownerDocument.defaultView!;
  const r = el.getBoundingClientRect();
  const init = { bubbles, cancelable: true, composed: true, view: win, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  const Ctor = type.startsWith('pointer') ? ((win as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent || (win as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent) : (win as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  el.dispatchEvent(new Ctor(type, init));
}

function dispatch(el: Element, type: string, extra: Record<string, unknown> = {}) {
  const win = el.ownerDocument.defaultView as unknown as { Event: typeof Event; InputEvent?: typeof InputEvent };
  const ev = type === 'input' && win.InputEvent ? new win.InputEvent('input', { bubbles: true, composed: true, ...extra }) : new win.Event(type, { bubbles: true });
  el.dispatchEvent(ev);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const win = el.ownerDocument.defaultView as unknown as { HTMLInputElement: typeof HTMLInputElement; HTMLTextAreaElement: typeof HTMLTextAreaElement };
  const proto = el.tagName.toLowerCase() === 'textarea' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function key(el: HTMLElement, type: string, k: string) {
  const win = el.ownerDocument.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent };
  return el.dispatchEvent(new win.KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, composed: true }));
}

async function typeText(page: Page, el: HTMLElement, text: string, delay: number) {
  for (const ch of text) {
    page._rt.checkAlive();
    const target = (el.ownerDocument.activeElement as HTMLElement) || el;
    key(target, 'keydown', ch);
    key(target, 'keypress', ch);
    if (target instanceof (target.ownerDocument.defaultView as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement && 'value' in target) {
      const input = target as HTMLInputElement;
      setNativeValue(input, input.value + ch);
      dispatch(input, 'input', { inputType: 'insertText', data: ch });
    }
    key(target, 'keyup', ch);
    if (delay) await page._rt.sleep(delay);
  }
  dispatch(el, 'change');
  await settle(page);
}

async function pressKey(page: Page, el: HTMLElement, combo: string) {
  const k = combo.split('+').pop() || combo;
  const proceed = key(el, 'keydown', k);
  if (proceed) {
    if (k.length === 1 && 'value' in el && !combo.includes('+')) {
      const input = el as HTMLInputElement;
      setNativeValue(input, input.value + k);
      dispatch(input, 'input', { inputType: 'insertText', data: k });
    } else if (k === 'Backspace' && 'value' in el) {
      const input = el as HTMLInputElement;
      setNativeValue(input, input.value.slice(0, -1));
      dispatch(input, 'input', { inputType: 'deleteContentBackward' });
    } else if (k === 'Enter') {
      const t = el.tagName.toLowerCase();
      const form = (el as HTMLInputElement).form;
      if (t === 'input' && form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new (el.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('submit', { bubbles: true, cancelable: true }));
      } else if (t === 'button' || t === 'a') {
        el.click();
      }
    } else if (k === 'Tab') {
      const focusables = Array.from(el.ownerDocument.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')).filter((e) => !e.hasAttribute('disabled') && isVisible(e));
      const i = focusables.indexOf(el);
      focusables[(i + 1) % focusables.length]?.focus();
    }
  }
  key(el, 'keyup', k);
  await settle(page);
}

/** Lets the app react to an event (microtasks + one frame), like Playwright's post-action wait. */
async function settle(page: Page) {
  await page._rt.sleep(30);
}

export function isPage(v: unknown): v is Page {
  return v instanceof Page;
}
export function isLocator(v: unknown): v is Locator {
  return v instanceof Locator;
}
export { SPEC };
