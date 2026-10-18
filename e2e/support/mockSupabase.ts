// A small in-memory stand-in for the Supabase REST API, so browser tests run
// the real app without a real project. It understands the PostgREST features
// the app uses (eq/neq/is/in/ilike/gt/gte/lt/lte filters, order, limit,
// single rows, counts, insert/update/delete) and records every request so
// tests can assert what the app wrote.
import { test as base, type BrowserContext, type Route } from '@playwright/test';

export const SUPABASE_URL = 'http://mock.supabase.test';
export const USER_ID = '00000000-0000-0000-0000-000000000001';

export type Row = Record<string, unknown>;

export interface RecordedRequest {
  table: string;
  rpc: boolean;
  method: string;
  query: string;
  body: unknown;
}

const daysFromNow = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
};
export { daysFromNow };

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

const CONTROL_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

const matches = (row: Row, column: string, condition: string): boolean => {
  // JSON paths such as metadata->>trigger.
  const [base, key] = column.split('->>');
  const value = key ? (row[base] as Row | null | undefined)?.[key] : row[column];
  const text = value == null ? null : String(value);
  const [operator, ...rest] = condition.split('.');
  const operand = rest.join('.');

  switch (operator) {
    case 'eq':
      return text === operand;
    case 'neq':
      return text !== operand;
    case 'is':
      return operand === 'null' ? value == null : String(value) === operand;
    case 'not':
      return !matches(row, column, operand);
    case 'in':
      return operand.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, '')).includes(text ?? '');
    case 'ilike':
    case 'like': {
      const pattern = operand.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*');
      return text !== null && new RegExp(`^${pattern}$`, operator === 'ilike' ? 'i' : '').test(text);
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (text === null) return false;
      const a = Number.isNaN(Number(text)) ? text : Number(text);
      const b = Number.isNaN(Number(operand)) ? operand : Number(operand);
      if (operator === 'gt') return a > b;
      if (operator === 'gte') return a >= b;
      if (operator === 'lt') return a < b;
      return a <= b;
    }
    default:
      // Filters this mock doesn't understand (e.g. or=) keep the row.
      return true;
  }
};

export class MockSupabase {
  readonly tables: Record<string, Row[]> = {};
  readonly rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  readonly requests: RecordedRequest[] = [];
  readonly user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'alice@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: daysFromNow(-100),
  };
  private inserted = 0;

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map((row) => ({ ...row }));
  }

  // Requests that changed a table (insert, update, delete).
  writes(table: string) {
    return this.requests.filter((r) => !r.rpc && r.table === table && ['POST', 'PATCH', 'DELETE'].includes(r.method));
  }

  rpcCalls(name: string) {
    return this.requests.filter((r) => r.rpc && r.table === name);
  }

  get session() {
    const expiresAt = Math.floor(Date.now() / 1000) + 36000;
    return {
      access_token: `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: USER_ID, exp: expiresAt, role: 'authenticated' })}.sig`,
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 36000,
      expires_at: expiresAt,
      user: this.user,
    };
  }

  async install(context: BrowserContext, { signedIn }: { signedIn: boolean }) {
    if (signedIn) {
      // supabase-js reads the session from this key for the mock project URL.
      await context.addInitScript((session) => {
        localStorage.setItem('sb-mock-auth-token', JSON.stringify(session));
      }, this.session);
    }

    // Google's sign-in script isn't needed by any test; keep runs offline.
    await context.route('https://accounts.google.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
    );
    await context.route(`${SUPABASE_URL}/**`, (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-expose-headers': 'content-range',
    };
    const reply = (status: number, body: unknown, contentRange = '*/0') =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { ...headers, 'content-range': contentRange },
        body: body === undefined ? '' : JSON.stringify(body),
      });

    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.startsWith('/auth/v1/user')) return reply(200, this.user);
    if (url.pathname.startsWith('/auth/')) return reply(200, {});
    if (url.pathname.startsWith('/storage/')) return reply(200, {});

    const match = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([^/]+)$/);
    if (!match) return reply(404, { message: 'Not found' });

    const isRpc = Boolean(match[1]);
    const name = match[2];
    let body: unknown = null;
    try {
      body = request.postData() ? JSON.parse(request.postData() as string) : null;
    } catch {
      body = request.postData();
    }

    this.requests.push({ table: name, rpc: isRpc, method, query: decodeURIComponent(url.search), body });

    if (isRpc) {
      const handler = this.rpcs[name];
      return handler ? reply(200, handler((body ?? {}) as Record<string, unknown>)) : reply(404, { message: `No mock for ${name}` });
    }

    const wantsObject = (request.headers()['accept'] || '').includes('vnd.pgrst.object');
    const table = (this.tables[name] ??= []);
    const filters = [...url.searchParams.entries()].filter(([key]) => !CONTROL_PARAMS.has(key));
    const selected = table.filter((row) => filters.every(([column, condition]) => matches(row, column, condition)));
    const respond = (rows: Row[], status = 200) =>
      reply(
        status,
        method === 'HEAD' ? undefined : wantsObject ? (rows[0] ?? null) : rows,
        rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0',
      );

    if (method === 'GET' || method === 'HEAD') {
      let rows = selected;
      const order = url.searchParams.get('order');
      if (order) {
        const [column, direction] = order.split(',')[0].split('.');
        rows = [...rows].sort((a, b) => {
          const result = String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
          return direction === 'desc' ? -result : result;
        });
      }
      const limit = Number(url.searchParams.get('limit'));
      return respond(limit ? rows.slice(0, limit) : rows);
    }

    if (method === 'POST') {
      const created = (Array.isArray(body) ? body : [body]).map((row) => ({
        id: `${name}_${++this.inserted}`,
        created_at: new Date().toISOString(),
        ...(row as Row),
      }));
      table.push(...created);
      return respond(created, 201);
    }

    if (method === 'PATCH') {
      selected.forEach((row) => Object.assign(row, body as Row));
      return respond(selected);
    }

    if (method === 'DELETE') {
      this.tables[name] = table.filter((row) => !selected.includes(row));
      return respond(selected);
    }

    return reply(405, { message: 'Method not allowed' });
  }
}

export const test = base.extend<{ signedIn: boolean; supabase: MockSupabase }>({
  signedIn: [true, { option: true }],
  // The fixture callback's second argument is named `provide` rather than
  // `use` so the React hooks lint rule doesn't mistake it for React's use().
  // Installed for every test (auto), so the app never reaches a real backend.
  supabase: [
    async ({ context, signedIn }, provide) => {
      const supabase = new MockSupabase();
      supabase.seed('profiles', [{ id: USER_ID, full_name: 'Alice Example', email: 'alice@example.com', onboarding_complete: true }]);
      await supabase.install(context, { signedIn });
      await provide(supabase);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
