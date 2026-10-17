// Serves preview.html, and nothing else, on 127.0.0.1. Every other path is a 404, so the raw and
// redacted chat files next to it are never reachable. Usage: npx tsx scripts/import/serve.ts [port]
// Then: portless alias veganway-import <port>  ->  https://veganway-import.localhost
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PREVIEW_HTML } from './paths.js';

const port = Number(process.argv[2] ?? 5181);

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method !== 'GET' || (path !== '/' && path !== '/index.html')) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  // Read on every request, so a rebuilt preview shows on reload.
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }).end(readFileSync(PREVIEW_HTML));
}).listen(port, '127.0.0.1', () => console.log(`Preview on 127.0.0.1:${port}`));
