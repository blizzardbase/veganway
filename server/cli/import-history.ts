// Imports listings found in the WhatsApp group's history. LISTINGS ONLY: no message text, no
// recommendations, no opinions and no counts, so each listing starts empty for members to fill.
// The group admin's decision of 2026-10-17. Records come from scripts/import (records.json), reviewed in the preview.
//
// Idempotent: a record is skipped when its source_key or its normalised name already exists, and when
// its id is in the exclusions list downloaded from the preview. Every listing is authored by the no login
// VeganWay system account, with no owner and no contact details; owners claim services later.
//
//   CLI: DATABASE_URL=... npx tsx server/cli/import-history.ts records.json [decisions.json]
//   Build: VW_IMPORT_FILE (and optionally VW_IMPORT_EXCLUDE_FILE), paths relative to the build root,
//          read by server/cli/vercel-migrate.ts on a production build only.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createDb, type Db } from '../db.js';
import { audit } from '../lib/audit.js';
import { containsContact } from '../lib/contact.js';
import { DUBAI_AREAS, NAME_MAX, PLACE_CATEGORIES, PRODUCT_CATEGORIES, STORES, SUMMARY_MAX } from '../../shared/types/listings.js';
import { SERVICE_AREAS, SERVICE_CATEGORIES } from '../../shared/types/services.js';
import { SYSTEM_USER_ID } from './launch.js';

/** Lowercase, no accents, "&" as "and", apostrophes dropped, every other run of symbols one space. */
export function normaliseName(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function sourceKey(name: string): string {
  return createHash('sha256').update(normaliseName(name)).digest('hex');
}

const text = (max: number) => z.string().max(max).refine((s) => !containsContact(s), 'contact details');

export const importRecordSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{64}$/),
    source_key: z.string().regex(/^[0-9a-f]{64}$/),
    kind: z.enum(['place', 'product', 'service']),
    name: text(NAME_MAX).refine((s) => s.trim().length > 0, 'empty name'),
    area: z.string().nullable(),
    vegan_status: z.enum(['fully_vegan', 'vegan_options', 'vegan_product']),
    category: z.string(),
    tags: z.array(text(40)).max(8),
    stores: z.array(z.enum(STORES)).max(STORES.length),
    summary: text(SUMMARY_MAX),
    /** Mention counts for the preview. Never imported. */
    preview: z.unknown().optional(),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message: `${r.name}: ${message}` });
    if (r.source_key !== sourceKey(r.name)) issue('source_key is not the sha256 of the normalised name');
    const categories: readonly string[] =
      r.kind === 'place' ? PLACE_CATEGORIES : r.kind === 'product' ? PRODUCT_CATEGORIES : SERVICE_CATEGORIES;
    if (r.category && !categories.includes(r.category)) issue(`category "${r.category}" is not a ${r.kind} category`);
    const areas: readonly string[] = r.kind === 'service' ? SERVICE_AREAS : DUBAI_AREAS;
    if (r.area !== null && !areas.includes(r.area)) issue(`area "${r.area}" is not allowed for a ${r.kind}`);
    if (r.kind === 'product' && r.area !== null) issue('a product has no area');
    if (r.kind !== 'product' && r.stores.length) issue('only a product has stores');
    if (r.kind === 'service' && r.vegan_status === 'vegan_product') issue('a service cannot be a vegan product');
  });

export type ImportRecord = z.infer<typeof importRecordSchema>;

// A type alias, not an interface, so it can go straight into the audit detail.
export type ImportResult = {
  inserted: number;
  excluded: number;
  skippedSourceKey: number;
  skippedName: number;
};

/** Parse a records file: an array of records, or { records, exclude }. Throws on any invalid record. */
export function parseImportFile(raw: unknown): { records: ImportRecord[]; exclude: string[] } {
  const shape = z.union([
    z.array(z.unknown()).transform((records) => ({ records, exclude: [] as string[] })),
    z.object({ records: z.array(z.unknown()), exclude: z.array(z.string()).default([]) }),
  ]);
  const { records, exclude } = shape.parse(raw);
  return { records: records.map((r) => importRecordSchema.parse(r)), exclude };
}

/** The preview's "Download decisions" file: { exclude: [ids] }, or a bare array of ids. */
export function parseExclusions(raw: unknown): string[] {
  return z.union([z.array(z.string()), z.object({ exclude: z.array(z.string()) }).transform((o) => o.exclude)]).parse(raw);
}

function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

export async function importHistory(db: Db, records: ImportRecord[], exclude: Iterable<string> = []): Promise<ImportResult> {
  const excluded = new Set(exclude);
  return db.tx(async (q) => {
    const existing = await q.query<{ name: string; source_key: string | null; slug: string }>('SELECT name, source_key, slug FROM listings');
    const keys = new Set(existing.map((l) => l.source_key).filter(Boolean));
    const names = new Set(existing.map((l) => normaliseName(l.name)));
    const slugs = new Set(existing.map((l) => l.slug));
    const result: ImportResult = { inserted: 0, excluded: 0, skippedSourceKey: 0, skippedName: 0 };
    for (const r of records) {
      if (excluded.has(r.id)) { result.excluded += 1; continue; }
      if (keys.has(r.source_key)) { result.skippedSourceKey += 1; continue; }
      if (names.has(normaliseName(r.name))) { result.skippedName += 1; continue; }
      const base = slugify(r.name) || r.kind;
      let slug = base;
      while (slugs.has(slug)) slug = `${base}-${randomBytes(3).toString('hex').slice(0, 5)}`;
      await q.query(
        `INSERT INTO listings (kind, name, slug, category, area, stores, vegan_status, summary, tags, created_by, source_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [r.kind, r.name.trim(), slug, r.category, r.area, r.stores, r.vegan_status, r.summary, r.tags, SYSTEM_USER_ID, r.source_key],
      );
      keys.add(r.source_key);
      names.add(normaliseName(r.name));
      slugs.add(slug);
      result.inserted += 1;
    }
    await audit(q, { actorId: null, action: 'import_history', detail: result });
    return result;
  });
}

/** Read the records file and optional exclusions file, both relative to `root`, and import. */
export async function importFromFiles(db: Db, root: string, file: string, excludeFile?: string): Promise<ImportResult> {
  const { records, exclude } = parseImportFile(JSON.parse(readFileSync(resolve(root, file), 'utf8')));
  const more = excludeFile ? parseExclusions(JSON.parse(readFileSync(resolve(root, excludeFile), 'utf8'))) : [];
  return importHistory(db, records, [...exclude, ...more]);
}

async function main() {
  const [file, excludeFile] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!file || !url) {
    console.error('Usage: DATABASE_URL=... npx tsx server/cli/import-history.ts records.json [decisions.json]');
    process.exit(1);
  }
  const db = createDb({ url });
  try {
    console.log('Import:', JSON.stringify(await importFromFiles(db, process.cwd(), file, excludeFile)));
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('Import failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  });
}
