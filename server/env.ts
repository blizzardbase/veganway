// Local environment for server/dev.ts and the command line tools. Vercel reads env in api/index.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const DATA_DIR = resolve(ROOT, 'data');
export const DEV_DB_URL = `pglite://${resolve(DATA_DIR, 'dev-pglite')}`;

export function databaseUrl(): string {
  return process.env.DATABASE_URL || DEV_DB_URL;
}

/**
 * SERVER_SECRET from the environment. In local dev only, when it is unset, a random secret is
 * created once in data/dev-secret (git ignored) so local accounts keep working across restarts.
 */
export function serverSecret(): string {
  const fromEnv = process.env.SERVER_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('pglite://')) {
    throw new Error('SERVER_SECRET is required when DATABASE_URL points at a real Postgres');
  }
  const file = resolve(DATA_DIR, 'dev-secret');
  if (!existsSync(file)) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, randomBytes(48).toString('base64'), { mode: 0o600 });
  }
  return readFileSync(file, 'utf8').trim();
}
