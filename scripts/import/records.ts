// extraction.json plus redacted.json to records.json. Usage: npx tsx scripts/import/records.ts
// extraction.json is written by hand from reading redacted.json: one entry per listing, with patterns
// that find the messages mentioning it. This script counts those messages and months for the preview,
// sets source_key, flags names that look like spelling variants of each other, and validates every
// record against the app's own rules before anything is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importRecordSchema, normaliseName, sourceKey, type ImportRecord } from '../../server/cli/import-history.js';
import type { RedactedMessage } from './redact.js';
import { RECORDS_JSON, REDACTED_JSON, WORK_DIR, ensureWorkDir, isMain } from './paths.js';

export const EXTRACTION_JSON = join(WORK_DIR, 'extraction.json');

export interface SpecListing {
  name: string;
  kind: ImportRecord['kind'];
  area: string | null;
  vegan_status: ImportRecord['vegan_status'];
  category: string;
  tags: string[];
  stores: ImportRecord['stores'];
  summary: string;
  /** Regular expressions, case insensitive unless matchCase is set, that find mentions. */
  match: string[];
  matchCase?: boolean;
  /** Shown in the preview; a flagged listing starts unticked. */
  flag?: string;
}

export interface Spec {
  listings: SpecListing[];
  dropped: { name?: string; reason: string }[];
}

export interface Preview {
  messages: number;
  months: string[];
  flag?: string;
}

/** The same grams as the database's vw_trigrams: each word padded "  w" + "ord ", cut into threes. */
export function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of normaliseName(text).split(' ').filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) grams.add(w.slice(i, i + 3));
  }
  return grams;
}

/** Share of a's grams found in b, the database's vw_trgm_cover. */
export function cover(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n += 1;
  return n / a.size;
}

export function buildRecords(spec: Spec, messages: RedactedMessage[]): { records: ImportRecord[]; similar: [string, string][] } {
  const records = spec.listings.map((l) => {
    const res = l.match.map((p) => new RegExp(p, l.matchCase ? 'u' : 'iu'));
    const hits = messages.filter((m) => res.some((re) => re.test(m.text)));
    // A message posted twice (a forward, a repeat) counts once.
    const preview: Preview = { messages: new Set(hits.map((m) => m.text)).size, months: [...new Set(hits.map((m) => m.date.slice(0, 7)))].sort() };
    if (l.flag) preview.flag = l.flag;
    const key = sourceKey(l.name);
    return importRecordSchema.parse({
      id: key, source_key: key, kind: l.kind, name: l.name, area: l.area, vegan_status: l.vegan_status,
      category: l.category, tags: l.tags, stores: l.stores, summary: l.summary, preview,
    });
  });
  const keys = records.map((r) => r.source_key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) throw new Error(`Two listings normalise to the same name: ${records.filter((r) => dupes.includes(r.source_key)).map((r) => r.name).join(', ')}`);
  const similar: [string, string][] = [];
  for (const [i, a] of records.entries()) {
    for (const b of records.slice(i + 1)) {
      const ga = trigrams(a.name);
      const gb = trigrams(b.name);
      if (Math.max(cover(ga, gb), cover(gb, ga)) >= 0.75) similar.push([a.name, b.name]);
    }
  }
  return { records, similar };
}

if (isMain(import.meta.url)) {
  const spec = JSON.parse(readFileSync(EXTRACTION_JSON, 'utf8')) as Spec;
  const messages = JSON.parse(readFileSync(REDACTED_JSON, 'utf8')) as RedactedMessage[];
  const { records, similar } = buildRecords(spec, messages);
  ensureWorkDir();
  writeFileSync(RECORDS_JSON, JSON.stringify(records, null, 1), { mode: 0o600 });
  const unmatched = records.filter((r) => (r.preview as Preview).messages === 0).map((r) => r.name);
  console.log(`Wrote ${records.length} listings. Dropped candidates: ${spec.dropped.length}.`);
  if (unmatched.length) console.log('No mentions matched (fix the patterns):', unmatched.join(', '));
  if (similar.length) console.log('Similar names to check:', similar.map((p) => p.join(' ~ ')).join('; '));
}
