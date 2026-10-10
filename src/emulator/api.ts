// Fake Bloomly REST API for the `request` fixture.
import { EmuError, callerLocation } from './errors';
import { BASE_URL } from './page';
import type { TestRuntime } from './runtime';

interface Product { id: string; name: string; category: string; price: number; inStock: boolean }
interface User { email: string; password: string; name: string; city: string; locked: boolean }
interface Order { id: number; user: string; date: string; items: string[]; total: number; status: string }
export interface AutData { products: Product[]; users: User[]; orders: Order[]; promoCodes: Record<string, { percent: number; expired: boolean }> }

let dataPromise: Promise<AutData> | null = null;
export function loadAutData(autDir: string): Promise<AutData> {
  if (!dataPromise) dataPromise = fetch(autDir + 'data.json').then((r) => r.json());
  return dataPromise;
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 423: 'Locked' };

export class APIResponse {
  private _status: number;
  private _body: unknown;
  private _url: string;
  private _headers: Record<string, string>;
  constructor(status: number, body: unknown, url: string) {
    this._status = status;
    this._body = body;
    this._url = url;
    this._headers = { 'content-type': 'application/json' };
  }
  get __pwDescription() { return `APIResponse: ${this._status} ${this._url}`; }
  status() { return this._status; }
  statusText() { return STATUS_TEXT[this._status] || ''; }
  ok() { return this._status >= 200 && this._status <= 299; }
  url() { return this._url; }
  headers() { return { ...this._headers }; }
  _bodyText() { return this._body === undefined ? '' : JSON.stringify(this._body); }
  async json() {
    if (this._body === undefined) throw new EmuError('api-json', 'apiResponse.json: Response body is empty', {});
    return JSON.parse(JSON.stringify(this._body));
  }
  async text() { return this._bodyText(); }
  async body() { return this._bodyText(); }
}

interface ReqOptions { data?: unknown; params?: Record<string, string | number>; headers?: Record<string, string> }

export class APIRequestContext {
  private rt: TestRuntime;
  private data: AutData;
  private bugs: string[];
  /** The browser context's storage: the app keeps created orders, new users and status changes there. */
  private storage: Record<string, string>;

  constructor(rt: TestRuntime, data: AutData, bugs: string[], storage: Record<string, string> = {}) {
    this.rt = rt;
    this.data = structuredClone(data);
    this.bugs = bugs;
    this.storage = storage;
  }

  private stored<T>(key: string, fallback: T): T {
    try { return key in this.storage ? JSON.parse(this.storage[key]) : fallback; } catch { return fallback; }
  }
  private allOrders(): Order[] {
    const status = this.stored<Record<string, string>>('orderStatus', {});
    return [...this.data.orders, ...this.stored<Order[]>('orders', [])].map((o) => (status[o.id] ? { ...o, status: status[o.id] } : o));
  }
  private allUsers(): User[] {
    return [...this.data.users, ...this.stored<User[]>('users', [])];
  }
  get __pwDescription() { return 'request'; }

  private call(method: string, url: string, opts: ReqOptions = {}) {
    const loc = callerLocation();
    return this.rt.api(`${method} "${url}"`, 'pw:api', loc, async () => {
      let target: URL;
      try { target = new URL(url, BASE_URL); } catch { throw new EmuError('goto-invalid', `apiRequestContext.${method.toLowerCase()}: Invalid URL`, { url }); }
      if (target.origin !== BASE_URL) throw new EmuError('goto-external', `apiRequestContext.${method.toLowerCase()}: getaddrinfo ENOTFOUND ${target.hostname}`, { url: target.href }, { emulatorNote: true });
      for (const [k, v] of Object.entries(opts.params || {})) target.searchParams.set(k, String(v));
      await this.rt.pace(`${method} ${url}`, loc?.line);
      await this.rt.sleep(40);
      const [status, body] = this.handle(method, target, opts);
      return new APIResponse(status, body, target.href);
    });
  }

  get(url: string, o?: ReqOptions) { return this.call('GET', url, o); }
  post(url: string, o?: ReqOptions) { return this.call('POST', url, o); }
  put(url: string, o?: ReqOptions) { return this.call('PUT', url, o); }
  patch(url: string, o?: ReqOptions) { return this.call('PATCH', url, o); }
  delete(url: string, o?: ReqOptions) { return this.call('DELETE', url, o); }
  fetch(url: string, o: ReqOptions & { method?: string } = {}) { return this.call((o.method || 'GET').toUpperCase(), url, o); }

  private user(headers?: Record<string, string>): User | null {
    const auth = Object.entries(headers || {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1] || '';
    const m = auth.match(/^Bearer token-(.+)$/);
    if (!m) return null;
    return this.allUsers().find((u) => u.email === decodeURIComponent(m[1])) || null;
  }

  private handle(method: string, url: URL, o: ReqOptions): [number, unknown] {
    const path = url.pathname.replace(/\/$/, '');
    const body = (o.data ?? {}) as Record<string, unknown>;
    const bug = (b: string) => this.bugs.includes(b);
    const pub = (p: Product) => ({ id: p.id, name: p.name, category: p.category, price: bug('api-price-string') ? p.price.toFixed(2) : p.price, inStock: p.inStock });
    if (path === '/api/health') return method === 'GET' ? [200, { status: 'ok' }] : [405, { error: 'Method not allowed' }];
    if (path === '/api/products') {
      if (method !== 'GET') return [405, { error: 'Method not allowed' }];
      let list = this.data.products;
      const cat = url.searchParams.get('category');
      const q = url.searchParams.get('q');
      if (cat) list = list.filter((p) => p.category === cat);
      if (q) list = list.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
      return [200, list.map(pub)];
    }
    const prod = path.match(/^\/api\/products\/([\w-]+)$/);
    if (prod) {
      if (method !== 'GET') return [405, { error: 'Method not allowed' }];
      const p = this.data.products.find((x) => x.id === prod[1]);
      return p ? [200, pub(p)] : [404, { error: 'Product not found' }];
    }
    if (path === '/api/login') {
      if (method !== 'POST') return [405, { error: 'Method not allowed' }];
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      if (!email || !password) return [400, { error: 'Email and password are required' }];
      const u = this.allUsers().find((x) => x.email === email);
      if (!u || u.password !== password) return [401, { error: 'Invalid email or password' }];
      if (u.locked && !bug('api-login-locked')) return [423, { error: 'Account is locked' }];
      return [200, { token: `token-${encodeURIComponent(u.email)}`, user: { email: u.email, name: u.name } }];
    }
    if (path === '/api/orders') {
      const u = this.user(o.headers);
      if (method === 'GET') {
        if (!u && !this.bugs.includes('api-orders-no-auth')) return [401, { error: 'Unauthorized' }];
        const all = this.allOrders();
        return [200, u ? all.filter((x) => x.user === u.email) : all];
      }
      if (method === 'POST') {
        if (!u) return [401, { error: 'Unauthorized' }];
        const items = body.items as Array<{ id: string; qty?: number }> | undefined;
        if (!Array.isArray(items) || !items.length) return [400, { error: 'Items are required' }];
        let subtotal = 0;
        const names: string[] = [];
        for (const it of items) {
          const p = this.data.products.find((x) => x.id === it.id);
          if (!p) return [400, { error: `Unknown product: ${it.id}` }];
          if (!p.inStock && !bug('api-out-of-stock-order')) return [409, { error: `${p.name} is out of stock` }];
          const qty = Math.max(1, Number(it.qty ?? 1));
          subtotal += p.price * qty;
          names.push(qty > 1 ? `${p.name} ×${qty}` : p.name);
        }
        const delivery = subtotal >= 50 || this.bugs.includes('api-total-no-delivery') ? 0 : 4.9;
        const id = Math.max(...this.allOrders().map((x) => x.id)) + 1;
        const order: Order = { id, user: u.email, date: new Date().toISOString().slice(0, 10), items: names, total: Math.round((subtotal + delivery) * 100) / 100, status: 'Processing' };
        this.storage.orders = JSON.stringify([...this.stored<Order[]>('orders', []), order]);
        return [201, order];
      }
      return [405, { error: 'Method not allowed' }];
    }
    const ord = path.match(/^\/api\/orders\/(\d+)$/);
    if (ord) {
      const u = this.user(o.headers);
      if (!u) return [401, { error: 'Unauthorized' }];
      const order = this.allOrders().find((x) => x.id === Number(ord[1]) && (x.user === u.email || bug('api-order-other-user')));
      if (!order) return [404, { error: 'Order not found' }];
      if (method === 'GET') return [200, order];
      if (method === 'DELETE') {
        if (order.status !== 'Processing') return [409, { error: 'Only processing orders can be cancelled' }];
        this.storage.orderStatus = JSON.stringify({ ...this.stored<Record<string, string>>('orderStatus', {}), [order.id]: 'Cancelled' });
        return [204, undefined];
      }
      return [405, { error: 'Method not allowed' }];
    }
    return [404, { error: `Not found: ${path}` }];
  }
}
