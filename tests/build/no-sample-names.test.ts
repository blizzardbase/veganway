// Hard rule 5: no sample or invented content ships. Builds nothing; scans dist/ after `npm run build`.
// The names are every entity from the deleted v1 seed (server/seed.ts) plus its sample assets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '../../dist');

const SAMPLE_NAMES = [
  'The Garden Table',
  'Garden Table',
  'Curry Leaf Kitchen',
  'Crumb Club',
  'Masa Mesa',
  'Oat Days Barista',
  'Oat Days',
  'Rise & Rye',
  'Rise &amp; Rye',
  'Olive Pantry',
  'Green Corner Deli',
  'Explore the sample community',
  'sample:v1:',
  'welcome.jpg',
];

const SAMPLE_FILES = /^(bowl|cake|curry|tacos|pantry|bread|welcome)(-[\w-]+)?\.jpe?g$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test('dist/ holds no sample entity names or sample images', () => {
  assert.ok(existsSync(join(DIST, 'client/index.html')), 'dist/client/index.html is missing: run npm run build first');
  const files = walk(DIST);
  const textFiles = files.filter((f) => /\.(html|js|mjs|css|json|webmanifest|txt|svg|map)$/i.test(f));
  assert.ok(textFiles.some((f) => f.endsWith('.js')), 'the scan found the built JavaScript');
  const hits: string[] = [];
  for (const file of textFiles) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const name of SAMPLE_NAMES) if (text.includes(name.toLowerCase())) hits.push(`${name} in ${file}`);
  }
  for (const file of files) if (SAMPLE_FILES.test(file.split('/').pop() ?? '')) hits.push(`sample image ${file}`);
  assert.deepEqual(hits, []);
});
