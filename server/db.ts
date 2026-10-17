// One thin adapter over two engines.
// postgres:// or postgresql:// URLs use a node-postgres Pool (Neon in production).
// pglite://memory and pglite://<dir> use PGlite, an in process Postgres, for tests and local dev.
// Both engines return int8 (bigint, count(*)) as a JS number and timestamptz as Date.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import type { PGlite } from '@electric-sql/pglite';

export type Param = string | number | boolean | null | Date | string[] | number[] | Buffer | Record<string, unknown> | unknown[];

export interface Queryable {
  /** Run one statement and return all rows. */
  query<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  /** Run one statement that must return exactly one row. Throws otherwise. */
  one<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T>;
  /** Run one statement and return the first row or null. */
  maybeOne<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T | null>;
  /** Run a script of several statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /**
   * Run fn inside one transaction. Use ONLY the q passed to fn inside it:
   * PGlite has a single connection, so a query on the outer db would wait forever.
   */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly engine: 'pg' | 'pglite';
}

export class NotOneRowError extends Error {
  name = 'NotOneRowError';
}

function wrap(run: <T>(sql: string, params?: Param[]) => Promise<T[]>, exec: (sql: string) => Promise<void>): Queryable {
  return {
    query: run,
    async one<T>(sql: string, params?: Param[]) {
      const rows = await run<T>(sql, params);
      if (rows.length !== 1) throw new NotOneRowError(`Expected one row, got ${rows.length}`);
      return rows[0];
    },
    async maybeOne<T>(sql: string, params?: Param[]) {
      const rows = await run<T>(sql, params);
      return rows[0] ?? null;
    },
    exec,
  };
}

const INT8_OID = 20;
const toNumber = (v: string) => Number(v);

/** Serverless friendly: few connections, closed quickly when idle, and a bounded wait for a new one. */
export const PG_POOL_OPTIONS = { max: 5, idleTimeoutMillis: 5000, connectionTimeoutMillis: 5000 } as const;

/**
 * The node-postgres Pool. An idle client that loses its connection (Neon scales to zero) emits
 * 'error' on the pool; without a listener that would crash the process. Logs the error name only.
 */
export function createPgPool(url: string): pg.Pool {
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const pool = new pg.Pool({
    connectionString: url,
    ...PG_POOL_OPTIONS,
    ssl: local ? undefined : { rejectUnauthorized: true },
    types: {
      getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        oid === INT8_OID ? toNumber : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
    },
  });
  pool.on('error', (e) => console.error('pg_pool_error', e.name));
  return pool;
}

function createPg(url: string): Db {
  const pool = createPgPool(url);
  const runOn = (client: pg.Pool | pg.PoolClient) => async <T>(sql: string, params?: Param[]) =>
    (await client.query(sql, params as unknown[])).rows as T[];
  const execOn = (client: pg.Pool | pg.PoolClient) => async (sql: string) => {
    await client.query(sql);
  };
  return {
    engine: 'pg',
    ...wrap(runOn(pool), execOn(pool)),
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(runOn(client), execOn(client)));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function createPglite(target: string): Db {
  // PGlite creates its data folder but not missing parents (data/ is absent on a fresh clone).
  if (target !== 'memory') mkdirSync(dirname(resolve(target)), { recursive: true });
  // Loaded lazily so the production function never loads PGlite (vercel.json also excludes it).
  const ready: Promise<PGlite> = import('@electric-sql/pglite').then(({ PGlite: Lite }) =>
    target === 'memory' ? new Lite({ parsers: { [INT8_OID]: toNumber } }) : new Lite(target, { parsers: { [INT8_OID]: toNumber } }));
  type Runner = Pick<PGlite, 'query' | 'exec'>;
  const runOn = (get: () => Promise<Runner>) => async <T>(sql: string, params?: Param[]) =>
    (await (await get()).query<T>(sql, params as unknown[])).rows;
  const execOn = (get: () => Promise<Runner>) => async (sql: string) => {
    await (await get()).exec(sql);
  };
  const lite = () => ready;
  return {
    engine: 'pglite',
    ...wrap(runOn(lite), execOn(lite)),
    tx: async <T>(fn: (q: Queryable) => Promise<T>) => {
      const db = await ready;
      return db.transaction((t) => fn(wrap(runOn(async () => t), execOn(async () => t))));
    },
    close: async () => (await ready).close(),
  };
}

export function createDb({ url }: { url: string }): Db {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return createPg(url);
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    if (!target) throw new Error('pglite URL needs "memory" or a directory');
    return createPglite(target);
  }
  throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite://');
}

/** True when a Postgres error is a unique violation, optionally on a named constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return Boolean(e && e.code === '23505' && (!constraint || e.constraint === constraint));
}
