// Local server. `npm run dev`: API plus Vite middleware with hot reload.
// `npm start` (NODE_ENV=production): API plus the built client from dist/client, with the
// same security headers as vercel.json, so CSP problems show up locally.
// With DATABASE_URL unset it uses PGlite at data/dev-pglite and applies migrations on start.
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { fsMediaStore } from './lib/media.js';
import { DATA_DIR, ROOT, databaseUrl, serverSecret } from './env.js';

const production = process.env.NODE_ENV === 'production';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const appOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const url = databaseUrl();
const mediaDir = resolve(DATA_DIR, 'media');

interface VercelHeaders { headers?: { source: string; headers: { key: string; value: string }[] }[] }

function vercelHeaders(): { key: string; value: string }[] {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) as VercelHeaders;
  return config.headers?.find((h) => h.source === '/(.*)')?.headers ?? [];
}

async function main() {
  const db = createDb({ url });
  if (url.startsWith('pglite://')) {
    const applied = await migrate(db);
    if (applied.length) console.log(`Migrations applied: ${applied.join(', ')}`);
  }

  const server = express();
  server.disable('x-powered-by');
  server.use('/media', express.static(mediaDir, { fallthrough: false, maxAge: '1h' }));
  // Test runs sign up many accounts from one loopback IP. Only an in memory database may relax the
  // per IP signup limit, so this switch can never loosen a real deployment.
  const relaxed = process.env.VW_E2E_RELAXED_LIMITS === '1' && url === 'pglite://memory';
  const limits = relaxed ? { signupIp: { max: 1000, windowSec: 3600 } } : undefined;
  server.use(createApp({ db, serverSecret: serverSecret(), appOrigin, media: fsMediaStore(mediaDir), limits }));

  if (production) {
    const clientDir = resolve(ROOT, 'dist/client');
    if (!existsSync(resolve(clientDir, 'index.html'))) throw new Error('dist/client is missing. Run npm run build first.');
    const headers = vercelHeaders();
    server.use((_req, res, next) => {
      for (const h of headers) res.set(h.key, h.value);
      next();
    });
    server.use('/assets', express.static(resolve(clientDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
    server.use(express.static(clientDir, { index: false, maxAge: 0 }));
    server.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: clientDir }));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
    server.use(vite.middlewares);
  }

  const listener = server.listen(port, host, () => {
    console.log(`VeganWay DXB ${production ? 'production build' : 'dev'} on ${appOrigin} (listening ${host}:${port}, ${url.startsWith('pglite://') ? 'PGlite' : 'Postgres'})`);
  });
  const stop = () => {
    listener.close();
    void db.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => {
  console.error('Startup failed:', err instanceof Error ? err.message : 'unknown error');
  process.exit(1);
});
