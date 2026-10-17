// Applies pending SQL files from server/migrations in name order.
// Each file runs inside its own transaction and is recorded in schema_migrations.
// CLI: `npm run migrate` reads DATABASE_URL. It never runs inside a request.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDb, type Db } from './db.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const NAME = /^\d{3}_[a-z0-9_]+\.sql$/;

export async function listMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
  const bad = files.filter((f) => !NAME.test(f));
  if (bad.length) throw new Error(`Migration names must look like 001_name.sql: ${bad.join(', ')}`);
  const numbers = files.map((f) => f.slice(0, 3));
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (dupes.length) throw new Error(`Duplicate migration numbers: ${dupes.join(', ')}`);
  return files.sort();
}

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied: string[] = [];
  for (const name of await listMigrations(dir)) {
    const sql = await readFile(`${dir}/${name}`, 'utf8');
    const done = await db.tx(async (q) => {
      // Serialise concurrent migrators on a real Postgres. Harmless on PGlite.
      await q.query('SELECT pg_advisory_xact_lock(7311)');
      if (await q.maybeOne('SELECT name FROM schema_migrations WHERE name = $1', [name])) return false;
      await q.exec(sql);
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      return true;
    });
    if (done) applied.push(name);
  }
  return applied;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const db = createDb({ url });
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply.');
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('Migration failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
