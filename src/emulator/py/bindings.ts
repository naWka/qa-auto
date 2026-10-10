// Playwright for Python (sync API) on top of the emulator's Page / Locator / APIRequestContext.
import { APIRequestContext, APIResponse } from '../api';
import { EmuError } from '../errors';
import { current, locatorMatchers, pageMatchers, pyMatcher, responseMatchers, type Ctx } from '../expect';
import { BASE_URL, Locator, Page } from '../page';
import { describeParts } from '../selectors';
import type { Interp } from './interp';
import {
  PyBuiltin, PyClass, PyDict, PyException, PyInstance, PyModule, PyPattern, fromJs, isHost, reprStr, toJs, typeName,
  type PyHost,
} from './values';

type Args = Record<string, unknown>;
const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * A Python method with a CPython-like signature check.
 * spec: positional-or-keyword names, then '*', then keyword-only names. A trailing '?' marks optional.
 */
export function method(ip: () => Interp, owner: string, name: string, spec: string[], impl: (a: Args) => unknown): PyBuiltin {
  const star = spec.indexOf('*');
  const pos = (star < 0 ? spec : spec.slice(0, star)).map((s) => ({ name: s.replace('?', ''), opt: s.endsWith('?') }));
  const kwonly = star < 0 ? [] : spec.slice(star + 1).map((s) => ({ name: s.replace('?', ''), opt: s.endsWith('?') }));
  const full = `${owner}.${name}()`;
  return new PyBuiltin(name, (args, kwargs) => {
    if (args.length > pos.length) {
      throw ip().err('TypeError', `${full} takes ${pos.length + 1} positional argument${pos.length ? 's' : ''} but ${args.length + 1} were given`);
    }
    const a: Args = {};
    pos.forEach((p, i) => { if (i < args.length) a[p.name] = args[i]; });
    for (const [k, v] of kwargs) {
      if (![...pos, ...kwonly].some((p) => p.name === k)) {
        const camel = /[A-Z]/.test(k) ? k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() : '';
        const hint = camel && [...pos, ...kwonly].some((p) => p.name === camel) ? `. Did you mean '${camel}'?` : '';
        throw ip().err('TypeError', `${full} got an unexpected keyword argument '${k}'${hint}`);
      }
      if (k in a) throw ip().err('TypeError', `${full} got multiple values for argument '${k}'`);
      a[k] = v;
    }
    const missing = [...pos, ...kwonly].filter((p) => !p.opt && !(p.name in a));
    if (missing.length) {
      throw ip().err('TypeError', `${full} missing ${missing.length} required ${missing[0] && kwonly.includes(missing[0]) ? 'keyword-only' : 'positional'} argument${missing.length > 1 ? 's' : ''}: ${missing.map((m) => `'${m.name}'`).join(' and ')}`);
    }
    return impl(a);
  }, owner);
}

/** Keyword options → JS options object (snake_case → camelCase, Python values → JS). */
function opts(a: Args, names: string[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const n of names) if (a[n] !== undefined && a[n] !== null) o[snakeToCamel(n)] = unwrap(a[n]);
  return o;
}

export function unwrap(v: unknown): unknown {
  if (v instanceof LocatorW) return v.loc;
  if (v instanceof PageW) return v.page;
  if (v instanceof APIResponseW) return v.res;
  if (v instanceof PyPattern) return v.re;
  if (v instanceof PyDict) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of v.items()) o[String(k)] = unwrap(x);
    return o;
  }
  if (Array.isArray(v)) return v.map(unwrap);
  return toJs(v);
}

function textArg(ip: () => Interp, v: unknown, owner: string): string | RegExp {
  if (v instanceof PyPattern) return v.re;
  if (typeof v === 'string') return v;
  throw ip().err('TypeError', `${owner}: expected str or re.Pattern, got ${typeName(v)}`);
}

function unsupported(what: string): never {
  throw new EmuError('pw-unsupported', `${what} is not available in the emulator`, { method: what }, { emulatorNote: true });
}

const ROLE_KW = ['checked?', 'disabled?', 'expanded?', 'include_hidden?', 'level?', 'name?', 'pressed?', 'selected?', 'exact?'];
const FILTER_KW = ['has_text?', 'has_not_text?', 'has?', 'has_not?', 'visible?'];

/** Locator factories shared by Page and Locator. */
function factories(ip: () => Interp, owner: string, make: (target: Page | Locator) => Locator | null, base: Page | Locator, wrap: (l: Locator) => LocatorW): Record<string, () => PyBuiltin> {
  const t = (n: string) => (a: Args) => textArg(ip, a.text, `${owner}.${n}`);
  void make;
  const call = (fn: (x: Page & Locator) => Locator) => wrap(fn(base as Page & Locator));
  return {
    locator: () => method(ip, owner, 'locator', ['selector_or_locator', '*', ...FILTER_KW], (a) => {
      const sel = a.selector_or_locator;
      const o = opts(a, ['has_text', 'has_not_text', 'has', 'has_not', 'visible']);
      if (sel instanceof LocatorW) {
        if (base instanceof Page) return wrap(new Locator(base, sel.loc._parts)).filterIf(o);
        return call((x) => x.locator(sel.loc, o));
      }
      if (typeof sel !== 'string') throw ip().err('TypeError', `${owner}.locator(): selector must be str or Locator, not ${typeName(sel)}`);
      return call((x) => x.locator(sel, o));
    }),
    get_by_role: () => method(ip, owner, 'get_by_role', ['role', '*', ...ROLE_KW], (a) => {
      const o = opts(a, ['checked', 'disabled', 'expanded', 'include_hidden', 'level', 'name', 'pressed', 'selected', 'exact']);
      if (typeof a.role !== 'string') throw ip().err('TypeError', `${owner}.get_by_role(): role must be str`);
      return call((x) => x.getByRole(a.role as string, o));
    }),
    get_by_text: () => method(ip, owner, 'get_by_text', ['text', '*', 'exact?'], (a) => call((x) => x.getByText(t('get_by_text')(a), opts(a, ['exact'])))),
    get_by_label: () => method(ip, owner, 'get_by_label', ['text', '*', 'exact?'], (a) => call((x) => x.getByLabel(t('get_by_label')(a), opts(a, ['exact'])))),
    get_by_placeholder: () => method(ip, owner, 'get_by_placeholder', ['text', '*', 'exact?'], (a) => call((x) => x.getByPlaceholder(t('get_by_placeholder')(a), opts(a, ['exact'])))),
    get_by_alt_text: () => method(ip, owner, 'get_by_alt_text', ['text', '*', 'exact?'], (a) => call((x) => x.getByAltText(t('get_by_alt_text')(a), opts(a, ['exact'])))),
    get_by_title: () => method(ip, owner, 'get_by_title', ['text', '*', 'exact?'], (a) => call((x) => x.getByTitle(t('get_by_title')(a), opts(a, ['exact'])))),
    get_by_test_id: () => method(ip, owner, 'get_by_test_id', ['test_id'], (a) => call((x) => x.getByTestId(textArg(ip, a.test_id, `${owner}.get_by_test_id`)))),
  };
}

// ---------- Page ----------

export interface PageEnvPy {
  ip: () => Interp;
  request: () => APIRequestContextW;
  context: () => ContextW;
}

export class PageW implements PyHost {
  readonly pyType = 'Page';
  page: Page;
  env: PageEnvPy;
  private keyboard?: PyHost;
  private members: Record<string, () => unknown>;
  constructor(page: Page, env: PageEnvPy) {
    this.page = page;
    this.env = env;
    const ip = env.ip;
    const m = (name: string, spec: string[], impl: (a: Args) => unknown) => () => method(ip, 'Page', name, spec, impl);
    const wrap = (l: Locator) => new LocatorW(l, this);
    this.members = {
      ...factories(ip, 'Page', () => null, page, wrap),
      url: () => page.url(),
      goto: m('goto', ['url', '*', 'timeout?', 'wait_until?', 'referer?'], async (a) => { await page.goto(String(a.url)); return null; }),
      reload: m('reload', ['*', 'timeout?', 'wait_until?'], async () => { await page.reload(); return null; }),
      go_back: m('go_back', ['*', 'timeout?', 'wait_until?'], async () => { await page.goBack(); return null; }),
      go_forward: m('go_forward', ['*', 'timeout?', 'wait_until?'], () => null),
      title: m('title', [], () => page.title()),
      content: m('content', [], () => page.content()),
      wait_for_timeout: m('wait_for_timeout', ['timeout'], async (a) => { await page.waitForTimeout(Number(a.timeout)); return null; }),
      wait_for_load_state: m('wait_for_load_state', ['state?', '*', 'timeout?'], async () => { await page.waitForLoadState(); return null; }),
      wait_for_url: m('wait_for_url', ['url', '*', 'timeout?', 'wait_until?'], async (a) => {
        const u = a.url instanceof PyPattern ? a.url.re : String(a.url);
        await page.waitForURL(u, opts(a, ['timeout']));
        return null;
      }),
      pause: m('pause', [], async () => { await page.pause(); return null; }),
      screenshot: m('screenshot', ['*', 'path?', 'full_page?', 'type?', 'timeout?'], () => unsupported('Page.screenshot')),
      click: m('click', ['selector', '*', 'timeout?', 'force?', 'button?', 'click_count?', 'delay?', 'position?', 'modifiers?', 'no_wait_after?', 'trial?', 'strict?'], async (a) => { await page.click(String(a.selector)); return null; }),
      fill: m('fill', ['selector', 'value', '*', 'timeout?', 'force?', 'no_wait_after?', 'strict?'], async (a) => { await page.fill(String(a.selector), a.value as string); return null; }),
      keyboard: () => (this.keyboard ??= new KeyboardW(page, ip)),
      request: () => env.request(),
      context: () => env.context(),
      set_default_timeout: m('set_default_timeout', ['timeout'], () => null),
      set_default_navigation_timeout: m('set_default_navigation_timeout', ['timeout'], () => null),
      is_closed: m('is_closed', [], () => false),
      close: m('close', ['*', 'run_before_unload?', 'reason?'], () => null),
      viewport_size: () => PyDict.from([['width', 1280], ['height', 720]]),
      evaluate: m('evaluate', ['expression', 'arg?'], () => unsupported('Page.evaluate')),
      expect_response: m('expect_response', ['url_or_predicate', '*', 'timeout?'], () => unsupported('Page.expect_response')),
      expect_navigation: m('expect_navigation', ['*', 'url?', 'wait_until?', 'timeout?'], () => unsupported('Page.expect_navigation')),
      expect_popup: m('expect_popup', ['*', 'predicate?', 'timeout?'], () => unsupported('Page.expect_popup')),
      route: m('route', ['url', 'handler', '*', 'times?'], () => unsupported('Page.route (network mocking)')),
      on: m('on', ['event', 'f'], () => unsupported('Page.on (events)')),
      mouse: () => unsupported('Page.mouse'),
    };
  }
  pyGetAttr(name: string): unknown {
    const f = this.members[name];
    return f ? f() : undefined;
  }
  pyDir() { return Object.keys(this.members); }
  pyRepr() { return `<Page url=${reprStr(this.page.url())}>`; }
}

class KeyboardW implements PyHost {
  readonly pyType = 'Keyboard';
  constructor(private page: Page, private ip: () => Interp) {}
  pyGetAttr(name: string): unknown {
    if (name === 'press') return method(this.ip, 'Keyboard', 'press', ['key', '*', 'delay?'], async (a) => { await this.page.keyboard.press(String(a.key)); return null; });
    if (name === 'type') return method(this.ip, 'Keyboard', 'type', ['text', '*', 'delay?'], async (a) => { await this.page.keyboard.type(String(a.text)); return null; });
    if (name === 'insert_text') return method(this.ip, 'Keyboard', 'insert_text', ['text'], async (a) => { await this.page.keyboard.type(String(a.text)); return null; });
    return undefined;
  }
  pyDir() { return ['press', 'type', 'insert_text']; }
}

// ---------- Locator ----------

const ACT_KW = ['timeout?', 'force?', 'no_wait_after?', 'trial?', 'position?', 'modifiers?', 'button?', 'click_count?', 'delay?', 'steps?'];

export class LocatorW implements PyHost {
  readonly pyType = 'Locator';
  loc: Locator;
  pageW: PageW;
  private members: Record<string, () => unknown>;
  constructor(loc: Locator, pageW: PageW) {
    this.loc = loc;
    this.pageW = pageW;
    const ip = pageW.env.ip;
    const m = (name: string, spec: string[], impl: (a: Args) => unknown) => () => method(ip, 'Locator', name, spec, impl);
    const wrap = (l: Locator) => new LocatorW(l, pageW);
    const act = (name: string, run: (a: Args) => PromiseLike<unknown>, spec: string[] = ['*', ...ACT_KW]) => m(name, spec, async (a) => { await run(a); return null; });
    this.members = {
      ...factories(ip, 'Locator', () => null, loc, wrap),
      first: () => wrap(loc.first()),
      last: () => wrap(loc.last()),
      nth: m('nth', ['index'], (a) => {
        if (typeof a.index !== 'number') throw ip().err('TypeError', `Locator.nth(): index must be int, not ${typeName(a.index)}`);
        return wrap(loc.nth(a.index));
      }),
      filter: m('filter', ['*', ...FILTER_KW], (a) => wrap(loc.filter(opts(a, ['has_text', 'has_not_text', 'has', 'has_not', 'visible']) as never))),
      and_: m('and_', ['locator'], (a) => wrap(loc.and((a.locator as LocatorW).loc))),
      or_: m('or_', ['locator'], (a) => wrap(loc.or((a.locator as LocatorW).loc))),
      page: () => pageW,
      click: act('click', (a) => loc.click(opts(a, ['timeout', 'force']))),
      dblclick: act('dblclick', (a) => loc.dblclick(opts(a, ['timeout', 'force']))),
      hover: act('hover', (a) => loc.hover(opts(a, ['timeout', 'force']))),
      focus: act('focus', (a) => loc.focus(opts(a, ['timeout'])), ['*', 'timeout?']),
      fill: act('fill', (a) => loc.fill(a.value as string, opts(a, ['timeout'])), ['value', '*', 'timeout?', 'no_wait_after?', 'force?']),
      clear: act('clear', (a) => loc.clear(opts(a, ['timeout'])), ['*', 'timeout?', 'no_wait_after?', 'force?']),
      press: act('press', (a) => loc.press(String(a.key), opts(a, ['timeout'])), ['key', '*', 'delay?', 'timeout?', 'no_wait_after?']),
      press_sequentially: act('press_sequentially', (a) => loc.pressSequentially(String(a.text), opts(a, ['delay', 'timeout'])), ['text', '*', 'delay?', 'timeout?', 'no_wait_after?']),
      type: act('type', (a) => loc.pressSequentially(String(a.text), opts(a, ['delay', 'timeout'])), ['text', '*', 'delay?', 'timeout?', 'no_wait_after?']),
      check: act('check', (a) => loc.check(opts(a, ['timeout', 'force']))),
      uncheck: act('uncheck', (a) => loc.uncheck(opts(a, ['timeout', 'force']))),
      set_checked: act('set_checked', (a) => loc.setChecked(!!a.checked, opts(a, ['timeout', 'force'])), ['checked', '*', ...ACT_KW]),
      select_option: m('select_option', ['value?', '*', 'index?', 'label?', 'element?', 'timeout?', 'no_wait_after?', 'force?'], async (a) => {
        let values: unknown;
        if (a.value !== undefined && a.value !== null) values = unwrap(a.value);
        else if (a.label !== undefined) values = Array.isArray(a.label) ? (a.label as unknown[]).map((l) => ({ label: l })) : { label: a.label };
        else if (a.index !== undefined) values = Array.isArray(a.index) ? (a.index as unknown[]).map((i) => ({ index: i })) : { index: a.index };
        else values = [];
        return fromJs(await loc.selectOption(values, opts(a, ['timeout'])));
      }),
      text_content: m('text_content', ['*', 'timeout?'], async (a) => fromJs(await loc.textContent(opts(a, ['timeout'])))),
      inner_text: m('inner_text', ['*', 'timeout?'], (a) => loc.innerText(opts(a, ['timeout']))),
      inner_html: m('inner_html', ['*', 'timeout?'], (a) => loc.innerHTML(opts(a, ['timeout']))),
      get_attribute: m('get_attribute', ['name', '*', 'timeout?'], async (a) => fromJs(await loc.getAttribute(String(a.name), opts(a, ['timeout'])))),
      input_value: m('input_value', ['*', 'timeout?'], (a) => loc.inputValue(opts(a, ['timeout']))),
      is_visible: m('is_visible', ['*', 'timeout?'], () => loc.isVisible()),
      is_hidden: m('is_hidden', ['*', 'timeout?'], () => loc.isHidden()),
      is_enabled: m('is_enabled', ['*', 'timeout?'], () => loc.isEnabled()),
      is_disabled: m('is_disabled', ['*', 'timeout?'], () => loc.isDisabled()),
      is_editable: m('is_editable', ['*', 'timeout?'], () => loc.isEditable()),
      is_checked: m('is_checked', ['*', 'timeout?'], () => loc.isChecked()),
      count: m('count', [], () => loc.count()),
      all: m('all', [], async () => ((await loc.all()) as Locator[]).map(wrap)),
      all_text_contents: m('all_text_contents', [], () => loc.allTextContents()),
      all_inner_texts: m('all_inner_texts', [], () => loc.allInnerTexts()),
      wait_for: m('wait_for', ['*', 'state?', 'timeout?'], async (a) => { await loc.waitFor(opts(a, ['state', 'timeout'])); return null; }),
      scroll_into_view_if_needed: m('scroll_into_view_if_needed', ['*', 'timeout?'], async () => { await loc.scrollIntoViewIfNeeded(); return null; }),
      highlight: m('highlight', [], () => null),
      evaluate: m('evaluate', ['expression', 'arg?', '*', 'timeout?'], () => unsupported('Locator.evaluate')),
      screenshot: m('screenshot', ['*', 'path?', 'timeout?'], () => unsupported('Locator.screenshot')),
      bounding_box: m('bounding_box', ['*', 'timeout?'], () => unsupported('Locator.bounding_box')),
    };
  }
  filterIf(o: Record<string, unknown>): LocatorW {
    return Object.keys(o).length ? new LocatorW(this.loc.filter(o as never), this.pageW) : this;
  }
  pyGetAttr(name: string): unknown {
    const f = this.members[name];
    return f ? f() : undefined;
  }
  pyDir() { return Object.keys(this.members); }
  pyRepr() { return `<Locator frame=<Frame name= url=${reprStr(this.loc._page.url())}> selector=${reprStr(describeParts(this.loc._parts))}>`; }
}

// ---------- API testing ----------

export class APIRequestContextW implements PyHost {
  readonly pyType = 'APIRequestContext';
  ctx: APIRequestContext;
  ip: () => Interp;
  constructor(ctx: APIRequestContext, ip: () => Interp) {
    this.ctx = ctx;
    this.ip = ip;
  }
  pyGetAttr(name: string): unknown {
    const verbs = ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'];
    if (verbs.includes(name)) {
      const spec = [name === 'fetch' ? 'url_or_request' : 'url', '*', 'params?', 'headers?', 'data?', 'form?', 'multipart?', 'timeout?', 'fail_on_status_code?', 'ignore_https_errors?', 'max_redirects?', 'max_retries?', ...(name === 'fetch' ? ['method?'] : [])];
      return method(this.ip, 'APIRequestContext', name, spec, async (a) => {
        const url = String(a.url ?? a.url_or_request);
        const o = { params: unwrap(a.params ?? undefined) as Record<string, string> | undefined, headers: unwrap(a.headers ?? undefined) as Record<string, string> | undefined, data: unwrap(a.data ?? a.form ?? undefined) };
        const c = this.ctx;
        const verb = name === 'fetch' ? String(a.method ?? 'GET').toUpperCase() : name.toUpperCase();
        const res = verb === 'HEAD' ? await c.fetch(url, { ...o, method: 'GET' }) : await c.fetch(url, { ...o, method: verb });
        if (a.fail_on_status_code && !res.ok()) {
          throw new EmuError('api-status', `APIRequestContext.${name}: ${res.status()} ${res.statusText()}`, { status: res.status() });
        }
        return new APIResponseW(res, this.ip);
      });
    }
    if (name === 'dispose') return method(this.ip, 'APIRequestContext', 'dispose', ['*', 'reason?'], () => { this.ctx.disposed = true; return null; });
    if (name === 'storage_state') return method(this.ip, 'APIRequestContext', 'storage_state', ['*', 'path?'], () => unsupported('APIRequestContext.storage_state'));
    return undefined;
  }
  pyDir() { return ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch', 'dispose', 'storage_state']; }
  pyRepr() { return '<APIRequestContext>'; }
}

export class APIResponseW implements PyHost {
  readonly pyType = 'APIResponse';
  constructor(public res: APIResponse, private ip: () => Interp) {}
  pyGetAttr(name: string): unknown {
    const r = this.res;
    const m = (n: string, impl: () => unknown) => method(this.ip, 'APIResponse', n, [], impl);
    switch (name) {
      case 'status': return r.status();
      case 'status_text': return r.statusText();
      case 'ok': return r.ok();
      case 'url': return r.url();
      case 'headers': return fromJs(r.headers());
      case 'headers_array': return fromJs(Object.entries(r.headers()).map(([k, v]) => ({ name: k, value: v })));
      case 'json': return m('json', async () => {
        if (!r._bodyText()) throw this.ip().err('JSONDecodeError', 'Expecting value: line 1 column 1 (char 0)');
        return fromJs(await r.json());
      });
      case 'text': return m('text', () => r.text());
      case 'body': return m('body', () => r.body());
      case 'dispose': return m('dispose', () => null);
    }
    return undefined;
  }
  pyDir() { return ['status', 'status_text', 'ok', 'url', 'headers', 'headers_array', 'json', 'text', 'body', 'dispose']; }
  pyRepr() { return `<APIResponse url=${reprStr(this.res.url())} status=${this.res.status()} status_text=${reprStr(this.res.statusText())}>`; }
}

// ---------- context / browser / playwright fixtures ----------

export class ContextW implements PyHost {
  readonly pyType = 'BrowserContext';
  constructor(private ip: () => Interp, private request: () => APIRequestContextW, private page: () => Promise<PageW>, private pages: () => PageW[]) {}
  pyGetAttr(name: string): unknown {
    const m = (n: string, spec: string[], impl: (a: Args) => unknown) => method(this.ip, 'BrowserContext', n, spec, impl);
    switch (name) {
      case 'request': return this.request();
      case 'new_page': return m('new_page', [], async () => {
        if (this.pages().length) unsupported('A second page in one test');
        return this.page();
      });
      case 'pages': return this.pages();
      case 'clear_cookies': return m('clear_cookies', ['*', 'name?', 'domain?', 'path?'], () => null);
      case 'add_cookies': return m('add_cookies', ['cookies'], () => null);
      case 'set_default_timeout': return m('set_default_timeout', ['timeout'], () => null);
      case 'close': return m('close', ['*', 'reason?'], () => null);
      case 'storage_state': return m('storage_state', ['*', 'path?', 'indexed_db?'], () => unsupported('BrowserContext.storage_state'));
      case 'tracing': return new TracingW(this.ip);
    }
    return undefined;
  }
  pyDir() { return ['request', 'new_page', 'pages', 'clear_cookies', 'add_cookies', 'set_default_timeout', 'close', 'storage_state', 'tracing']; }
}

class TracingW implements PyHost {
  readonly pyType = 'Tracing';
  constructor(private ip: () => Interp) {}
  pyGetAttr(name: string): unknown {
    if (name === 'start') return method(this.ip, 'Tracing', 'start', ['*', 'name?', 'title?', 'snapshots?', 'screenshots?', 'sources?'], () => null);
    if (name === 'stop') return method(this.ip, 'Tracing', 'stop', ['*', 'path?'], () => null);
    return undefined;
  }
}

export class BrowserW implements PyHost {
  readonly pyType = 'Browser';
  constructor(private ip: () => Interp) {}
  pyGetAttr(name: string): unknown {
    const m = (n: string) => method(this.ip, 'Browser', n, ['*', 'base_url?', 'viewport?', 'storage_state?', 'locale?', 'record_video_dir?', 'user_agent?', 'http_credentials?', 'extra_http_headers?'], () => unsupported(`Browser.${n} (one browser context per test)`));
    if (name === 'new_context' || name === 'new_page') return m(name);
    if (name === 'version') return '131.0';
    if (name === 'close') return method(this.ip, 'Browser', 'close', [], () => null);
    if (name === 'browser_type') return PyDict.from([['name', 'chromium']]);
    return undefined;
  }
  pyDir() { return ['new_context', 'new_page', 'version', 'close']; }
}

export class PlaywrightW implements PyHost {
  readonly pyType = 'Playwright';
  constructor(private ip: () => Interp, private newApi: (headers: Record<string, string>) => APIRequestContextW) {}
  pyGetAttr(name: string): unknown {
    if (name === 'request') {
      const ip = this.ip;
      const newApi = this.newApi;
      return {
        pyType: 'APIRequest',
        pyGetAttr: (n: string) => n === 'new_context'
          ? method(ip, 'APIRequest', 'new_context', ['*', 'base_url?', 'extra_http_headers?', 'http_credentials?', 'ignore_https_errors?', 'proxy?', 'user_agent?', 'timeout?', 'storage_state?', 'fail_on_status_code?', 'max_redirects?'], (a) => {
            if (a.base_url && !String(a.base_url).startsWith(BASE_URL)) {
              throw new EmuError('goto-external', `APIRequest.new_context: the emulator only reaches Bloomly (${BASE_URL}), not ${String(a.base_url)}`, { url: String(a.base_url) }, { emulatorNote: true });
            }
            return newApi((unwrap(a.extra_http_headers ?? undefined) as Record<string, string>) ?? {});
          })
          : undefined,
        pyDir: () => ['new_context'],
      } as PyHost;
    }
    if (name === 'chromium' || name === 'firefox' || name === 'webkit') {
      return { pyType: 'BrowserType', pyGetAttr: (n: string) => (n === 'launch' || n === 'connect' ? method(this.ip, 'BrowserType', n, ['*', 'headless?', 'slow_mo?', 'channel?', 'args?'], () => unsupported('BrowserType.launch (the page fixture already gives you a browser)')) : n === 'name' ? name : undefined) } as PyHost;
    }
    if (name === 'devices') return new PyDict();
    if (name === 'stop') return method(this.ip, 'Playwright', 'stop', [], () => null);
    return undefined;
  }
  pyDir() { return ['request', 'chromium', 'firefox', 'webkit', 'devices', 'stop']; }
}

// ---------- expect ----------

const LOCATOR_SIGS: Record<string, string[]> = {
  toBeAttached: ['*', 'attached?', 'timeout?'],
  toBeChecked: ['*', 'timeout?', 'checked?', 'indeterminate?'],
  toBeDisabled: ['*', 'timeout?'],
  toBeEditable: ['*', 'editable?', 'timeout?'],
  toBeEmpty: ['*', 'timeout?'],
  toBeEnabled: ['*', 'enabled?', 'timeout?'],
  toBeFocused: ['*', 'timeout?'],
  toBeHidden: ['*', 'timeout?'],
  toBeInViewport: ['*', 'ratio?', 'timeout?'],
  toBeVisible: ['*', 'visible?', 'timeout?'],
  toContainClass: ['expected', '*', 'timeout?'],
  toContainText: ['expected', '*', 'use_inner_text?', 'timeout?', 'ignore_case?'],
  toHaveAttribute: ['name', 'value', '*', 'ignore_case?', 'timeout?'],
  toHaveClass: ['expected', '*', 'timeout?'],
  toHaveCount: ['count', '*', 'timeout?'],
  toHaveId: ['id', '*', 'timeout?'],
  toHaveText: ['expected', '*', 'use_inner_text?', 'timeout?', 'ignore_case?'],
  toHaveValue: ['value', '*', 'timeout?'],
  toHaveValues: ['values', '*', 'timeout?'],
};
const PAGE_SIGS: Record<string, string[]> = {
  toHaveURL: ['url_or_reg_exp', '*', 'timeout?', 'ignore_case?'],
  toHaveTitle: ['title_or_reg_exp', '*', 'timeout?'],
};

class AssertionsW implements PyHost {
  readonly pyType: string;
  private names: string[];
  constructor(private ip: () => Interp, private actual: LocatorW | PageW | APIResponseW, private message?: string) {
    this.pyType = actual instanceof LocatorW ? 'LocatorAssertions' : actual instanceof PageW ? 'PageAssertions' : 'APIResponseAssertions';
    const base = actual instanceof LocatorW ? Object.keys(LOCATOR_SIGS) : actual instanceof PageW ? Object.keys(PAGE_SIGS) : ['toBeOK'];
    this.names = base.flatMap((n) => [pyMatcher(n), 'not_' + pyMatcher(n)]);
  }
  pyGetAttr(name: string): unknown {
    if (!this.names.includes(name)) return undefined;
    const isNot = name.startsWith('not_');
    const py = isNot ? name.slice(4) : name;
    const ctx: Ctx = { isNot, message: this.message };
    const a = this.actual;
    if (a instanceof APIResponseW) return method(this.ip, this.pyType, name, [], () => responseMatchers(a.res, ctx).toBeOK());
    const sigs = a instanceof LocatorW ? LOCATOR_SIGS : PAGE_SIGS;
    const camel = Object.keys(sigs).find((k) => pyMatcher(k) === py)!;
    const spec = sigs[camel];
    return method(this.ip, this.pyType, name, spec, async (args) => {
      const positional = spec.filter((s) => s !== '*' && !s.endsWith('?') && spec.indexOf(s) < spec.indexOf('*')).map((s) => args[s]);
      const kws = spec.slice(spec.indexOf('*') + 1).map((s) => s.replace('?', ''));
      const o = opts(args, kws);
      const conv = positional.map((v) => (v instanceof PyPattern ? v.re : unwrap(v)));
      if (a instanceof LocatorW) {
        const matchers = locatorMatchers(a.loc, ctx) as unknown as Record<string, (...x: unknown[]) => PromiseLike<void>>;
        if (camel === 'toHaveAttribute') await matchers.toHaveAttribute(conv[0], conv[1], o);
        else await matchers[camel](...conv, o);
      } else {
        const matchers = pageMatchers((a as PageW).page, ctx) as unknown as Record<string, (...x: unknown[]) => PromiseLike<void>>;
        await matchers[camel](...conv, o);
      }
      return null;
    });
  }
  pyDir() { return this.names; }
}

/** The `expect` function of playwright.sync_api. */
export function makeExpect(ip: () => Interp): PyBuiltin {
  const ex = new PyBuiltin('expect', (args, kwargs) => {
    const actual = args[0];
    const message = (args[1] ?? kwargs.get('message') ?? undefined) as string | undefined;
    if (actual instanceof LocatorW || actual instanceof PageW || actual instanceof APIResponseW) return new AssertionsW(ip, actual, message ?? undefined);
    const cls = typeName(actual);
    const e = ip().err('ValueError', `Unsupported type: <class '${cls}'>`);
    e.emu = { code: 'expect-unsupported', message: `ValueError: Unsupported type: <class '${cls}'>`, data: { type: cls } };
    throw e;
  });
  ex.attrs.set('set_options', new PyBuiltin('set_options', (_a, k) => {
    if (k.has('timeout')) current.expectTimeout = Number(k.get('timeout'));
    return null;
  }));
  return ex;
}

// ---------- modules ----------

export function playwrightModules(ip: () => Interp, E: Record<string, PyClass>, expect: PyBuiltin): Record<string, () => PyModule> {
  const hostClass = (name: string, pyType: string) => {
    const c = new PyClass(name, [E.object], 'playwright.sync_api');
    c.check = (v) => isHost(v) && v.pyType === pyType;
    c.native = () => { throw ip().err('TypeError', `cannot create '${name}' instances — get it from a fixture (page, playwright, …)`); };
    return c;
  };
  const sync = () => {
    const m = new PyModule('playwright.sync_api');
    m.dict.set('expect', expect);
    m.dict.set('Page', hostClass('Page', 'Page'));
    m.dict.set('Locator', hostClass('Locator', 'Locator'));
    m.dict.set('BrowserContext', hostClass('BrowserContext', 'BrowserContext'));
    m.dict.set('Browser', hostClass('Browser', 'Browser'));
    m.dict.set('Playwright', hostClass('Playwright', 'Playwright'));
    m.dict.set('APIRequestContext', hostClass('APIRequestContext', 'APIRequestContext'));
    m.dict.set('APIResponse', hostClass('APIResponse', 'APIResponse'));
    m.dict.set('Error', E.PlaywrightError);
    m.dict.set('TimeoutError', E.PlaywrightTimeoutError);
    m.dict.set('sync_playwright', new PyBuiltin('sync_playwright', () => unsupported('sync_playwright() (use the page fixture of pytest-playwright)')));
    return m;
  };
  const root = () => {
    const m = new PyModule('playwright');
    return m;
  };
  return { playwright: root, 'playwright.sync_api': sync };
}

/** Converts emulator errors (Playwright, expect) into Python exceptions. */
export function convertEmuError(ip: () => Interp, E: Record<string, PyClass>, e: unknown): PyException | null {
  if (!(e instanceof EmuError)) return null;
  if (e.code === 'closed') return null;
  const timeoutCodes = new Set(['action-timeout', 'action-not-actionable', 'nav-timeout', 'wait-url-timeout', 'wait-timeout', 'select-missing']);
  const cls = e.code.startsWith('expect-') ? E.AssertionError : timeoutCodes.has(e.code) ? E.PlaywrightTimeoutError : E.PlaywrightError;
  const inst = new PyInstance(cls);
  inst.dict.set('args', [e.message]);
  const x = new PyException(inst);
  x.emu = { code: e.code, message: e.message, data: e.data, emulatorNote: e.emulatorNote };
  x.tb = ip().snapshot();
  return x;
}
