// The first load: nothing render blocking but the main CSS, the latin font preloaded, and the
// JavaScript a first visit downloads kept under budget. Scans dist/ after `npm run build`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const CLIENT = resolve(import.meta.dirname, '../../dist/client');
const BUDGET_KB = 180;

function html(): string {
  const file = join(CLIENT, 'index.html');
  assert.ok(existsSync(file), 'dist/client/index.html is missing: run npm run build first');
  return readFileSync(file, 'utf8');
}

test('only the main CSS blocks rendering', () => {
  const page = html();
  const scripts = [...page.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  for (const attrs of scripts) {
    assert.match(attrs, /(\btype="module"|\bdefer\b|\basync\b)/, `render blocking script: <script${attrs}>`);
  }
  const sheets = [...page.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)];
  assert.equal(sheets.length, 1, 'exactly one stylesheet');
});

test('the Manrope latin font is preloaded and the file exists', () => {
  const m = html().match(/<link rel="preload" href="(\/assets\/manrope-latin-wght-normal-[\w-]+\.woff2)" as="font" type="font\/woff2" crossorigin \/>/);
  assert.ok(m, 'font preload tag');
  assert.ok(existsSync(join(CLIENT, m[1])), `${m[1]} exists`);
});

test(`the JavaScript a first visit downloads stays under ${BUDGET_KB} KB gzip`, () => {
  const files = [...html().matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  assert.ok(files.length > 1);
  const total = files.reduce((n, f) => n + gzipSync(readFileSync(join(CLIENT, f)), { level: 9 }).length, 0) / 1024;
  assert.ok(total <= BUDGET_KB, `initial JS is ${total.toFixed(1)} KB gzip`);
});
