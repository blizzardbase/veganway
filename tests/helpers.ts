// API test helpers. Every test app is a fresh in memory PGlite database, fully migrated.
//
//   const app = await makeTestApp();
//   const alice = await signUp(app.agent());          // a signed in member
//   const res = await alice.agent.post('/api/listings', { ... });   // CSRF and Origin are added for you
//   const admin = await asAdmin(app);
//   await app.close();
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createDb, type Db, type Queryable } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { scryptHasher, type PasswordHasher } from '../server/lib/crypto.js';
import { fsMediaStore, type MediaStore } from '../server/lib/media.js';
import { memoryMailer, type Mailer } from '../server/lib/mailer.js';
import type { Limits } from '../server/lib/rate.js';
import type { AuthResponse, Me } from '../shared/types.js';

export const TEST_ORIGIN = 'http://veganway.test';
export const TEST_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export interface RequestOptions {
  /** false: send no CSRF header. A string: send that value. Default: the agent's known token. */
  csrf?: boolean | string;
  /** null: send no Origin header. Default: the test origin. */
  origin?: string | null;
  headers?: Record<string, string>;
  /** Send raw bytes (photo upload) instead of JSON. */
  raw?: { body: Buffer; contentType: string };
}

/** A browser like client: keeps cookies, sends Origin, and sends the CSRF token it last saw. */
export class Agent {
  readonly cookies = new Map<string, string>();
  csrf: string | null = null;

  constructor(readonly baseUrl: string) {}

  async request<T = unknown>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.origin !== null) headers.origin = opts.origin ?? TEST_ORIGIN;
    const csrf = opts.csrf === false ? null : typeof opts.csrf === 'string' ? opts.csrf : this.csrf;
    if (csrf) headers['x-csrf-token'] = csrf;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let payload: string | Uint8Array | undefined;
    if (opts.raw) {
      headers['content-type'] = opts.raw.contentType;
      payload = new Uint8Array(opts.raw.body);
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.baseUrl + path, { method, headers, body: payload, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0/i.test(a) || /^\s*expires=thu, 01 jan 1970/i.test(a));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Leave non JSON bodies as text.
    }
    const maybe = parsed as { csrf?: unknown } | null;
    if (maybe && typeof maybe === 'object' && 'csrf' in maybe) this.csrf = typeof maybe.csrf === 'string' ? maybe.csrf : null;
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = unknown>(path: string, opts?: RequestOptions) { return this.request<T>('GET', path, undefined, opts); }
  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) { return this.request<T>('POST', path, body ?? {}, opts); }
  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) { return this.request<T>('PUT', path, body ?? {}, opts); }
  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions) { return this.request<T>('PATCH', path, body ?? {}, opts); }
  delete<T = unknown>(path: string, opts?: RequestOptions) { return this.request<T>('DELETE', path, undefined, opts); }
}

export interface TestApp {
  baseUrl: string;
  mailer: ReturnType<typeof memoryMailer>;
  db: Db;
  /** How many times the app ran scrypt, by operation. Lets a test prove a limit fired before scrypt. */
  scrypt: { hash: number; verify: number };
  /** The folder the filesystem media adapter writes photo bytes to. */
  mediaDir: string;
  agent(): Agent;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /**
   * Rule overrides. By default the signup per IP rule is raised to 1000 so tests can create many
   * members from 127.0.0.1; every other rule uses the real numbers. Pass { signupIp: DEFAULT_LIMITS.signupIp } to test it.
   */
  limits?: Partial<Limits>;
  mailer?: Mailer;
  /** Express trust proxy setting, so a test can send X-Forwarded-For to act as many clients. */
  trustProxy?: boolean | number;
  /** When given, every SQL statement the app runs (inside a transaction or not) is pushed here in order. */
  sqlLog?: string[];
  /** Wrap the filesystem media adapter, e.g. to make deletes fail. */
  media?: (store: MediaStore) => MediaStore;
}

/** A Db that records every statement into log, including statements inside tx. */
function recordingDb(db: Db, log: string[]): Db {
  const spy = (q: Queryable): Queryable => ({
    query: (sql, params) => { log.push(sql); return q.query(sql, params); },
    one: (sql, params) => { log.push(sql); return q.one(sql, params); },
    maybeOne: (sql, params) => { log.push(sql); return q.maybeOne(sql, params); },
    exec: (sql) => { log.push(sql); return q.exec(sql); },
  }) as Queryable;
  return {
    ...spy(db),
    engine: db.engine,
    tx: (fn) => db.tx((q) => fn(spy(q))),
    close: () => db.close(),
  };
}

export async function makeTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const db = createDb({ url: 'pglite://memory' });
  await migrate(db);
  const scrypt = { hash: 0, verify: 0 };
  const passwords: PasswordHasher = {
    hash: (p) => { scrypt.hash++; return scryptHasher.hash(p); },
    verify: (p, s) => { scrypt.verify++; return scryptHasher.verify(p, s); },
  };
  const mediaDir = mkdtempSync(join(tmpdir(), 'vw-media-'));
  const mailer = memoryMailer();
  const app = createApp({
    mailer: options.mailer ?? mailer,
    db: options.sqlLog ? recordingDb(db, options.sqlLog) : db,
    serverSecret: TEST_SECRET,
    appOrigin: TEST_ORIGIN,
    media: options.media ? options.media(fsMediaStore(mediaDir)) : fsMediaStore(mediaDir),
    passwords,
    trustProxy: options.trustProxy,
    limits: { signupIp: { max: 1000, windowSec: 3600 }, ...options.limits },
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    mailer,
    db,
    scrypt,
    mediaDir,
    agent: () => new Agent(baseUrl),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    },
  };
}

let counter = 0;
export function uniqueEmail(prefix = 'member'): string {
  counter++;
  return `${prefix}.${process.pid}.${Date.now()}.${counter}@example.test`;
}

export interface SignedUp {
  agent: Agent;
  user: Me;
  email: string;
  password: string;
}

/** Sign up through the real API and confirm the pseudonym. The agent is then signed in with a CSRF token. */
export async function signUp(agent: Agent, opts: { email?: string; password?: string } = {}): Promise<SignedUp> {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? 'correct horse battery';
  const res = await agent.post<AuthResponse>('/api/auth/signup', { email, password });
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  const confirmed = await agent.post<{ user: Me }>('/api/auth/confirm-pseudonym');
  if (confirmed.status !== 200) throw new Error(`confirm failed: ${confirmed.status}`);
  return { agent, user: confirmed.body.user, email, password };
}

/** A fresh signed in member with the admin role (granted directly in the database). */
export async function asAdmin(app: TestApp): Promise<SignedUp> {
  const member = await signUp(app.agent());
  await app.db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [member.user.id]);
  const me = await member.agent.get<{ user: Me }>('/api/me');
  return { ...member, user: me.body.user };
}

/** Make an account look older, e.g. to pass the 24 hour rules for reports and caps. */
export async function backdateUser(db: Db, userId: string, hours: number): Promise<void> {
  await db.query(`UPDATE users SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, [userId, hours]);
}
