// Listings slice. Mounted at /api. This router owns:
//   GET    /listings                          list: kind, area, vegan_status, category, store, has_offer, sort=top|new, cursor
//   GET    /listings/suggest?q=&kind=         duplicate check typeahead, top 5
//   GET    /listings/offers/active            unexpired offers, newest first (Deals strip). Alias: GET /offers/active
//   POST   /listings                          create a place or product
//   GET    /listings/:slug                    one listing (any kind; services render on the services screen)
//   PATCH  /listings/:slug                    edit: creator within 24 hours while nobody else owns it, or an admin
//   PUT    /listings/:slug/opinion            { value: 'recommend' | 'not_for_me' }
//   DELETE /listings/:slug/opinion
//   POST   /listings/:slug/bookmark           toggle; PUT saves, DELETE unsaves
//   GET    /bookmarks                         my saved listings (private)
//   GET    /listings/:slug/recommendations    upvotes, then newest
//   POST   /listings/:slug/recommendations    body, optional offer with expiry date, optional photo
//   POST   /recommendations/:id/upvote        toggle; PUT upvotes, DELETE removes
// Public reads work signed out and show authors only as pseudonym, display name and avatar (lib/author.ts).
// Hidden listings and recommendations are invisible (404) to everyone but admins.
import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { isUniqueViolation, type Param, type Queryable } from '../db.js';
import { audit } from '../lib/audit.js';
import { authorCols, toAuthor, type AuthorRow } from '../lib/author.js';
import { currentUser, requireUser, type SessionUser } from '../lib/auth.js';
import { checkCap } from '../lib/caps.js';
import { rejectContact } from '../lib/contact.js';
import { fail, parse } from '../lib/http.js';
import { mediaUrl } from './photos.js';
import { SERVICE_CATEGORIES } from '../../shared/types/services.js';
import {
  BODY_MAX, DUBAI_AREAS, EDIT_WINDOW_HOURS, NAME_MAX, OFFER_MAX, OFFER_MAX_DAYS, PAGE_SIZE, PLACE_CATEGORIES, PRODUCT_CATEGORIES,
  STORES, SUMMARY_MAX, VEGAN_STATUS_REQUIRED,
  type ActiveOffer, type DealItem, type ListingCard, type ListingDetail, type ListingKind, type ListingSuggestion,
  type OpinionCounts, type OpinionValue, type Page, type Recommendation, type VeganStatus,
} from '../../shared/types/listings.js';

// ---------- validation ----------

const MAPS_HOSTS_ANY_PATH = new Set(['maps.google.com', 'maps.app.goo.gl', 'maps.apple.com', 'maps.apple']);
const MAPS_HOSTS_MAPS_PATH = new Set(['goo.gl', 'google.com', 'www.google.com', 'google.ae', 'www.google.ae']);

/** Only https Google Maps or Apple Maps links. Returns the normalised URL or null. */
export function normalizeMapsUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (MAPS_HOSTS_ANY_PATH.has(host)) return u.toString();
  if (MAPS_HOSTS_MAPS_PATH.has(host) && (u.pathname === '/maps' || u.pathname.startsWith('/maps/'))) return u.toString();
  return null;
}

const name = z.string({ error: 'Enter a name.' }).trim().min(2, { error: 'Enter a name of at least 2 characters.' })
  .max(NAME_MAX, { error: `Keep the name under ${NAME_MAX} characters.` });
const optionalText = (max: number, label: string) =>
  z.string({ error: `${label} must be text.` }).trim().max(max, { error: `Keep ${label.toLowerCase()} under ${max} characters.` }).optional();
const mapsUrl = z.string({ error: 'Paste a Google Maps or Apple Maps link.' }).trim().max(500, { error: 'That link is too long.' })
  .transform((v, ctx) => {
    if (!v) return undefined;
    const ok = normalizeMapsUrl(v);
    if (!ok) {
      ctx.addIssue({ code: 'custom', message: 'Only Google Maps or Apple Maps links (https) are allowed.' });
      return z.NEVER;
    }
    return ok;
  });
const photoId = z.uuid({ error: 'That photo is not valid. Please add it again.' });
const opinionValue = z.enum(['recommend', 'not_for_me'], { error: 'Choose Recommend or Not for me.' });
const area = z.enum(DUBAI_AREAS, { error: 'Choose an area.' });
const store = z.enum(STORES, { error: 'Choose a store from the list.' });
const stores = z.array(store, { error: 'Choose at least one store.' }).min(1, { error: 'Choose at least one store.' })
  .max(STORES.length).transform((s) => [...new Set(s)]);
const placeStatus = z.enum(['fully_vegan', 'vegan_options'], { error: VEGAN_STATUS_REQUIRED });
const tags = z.array(z.string().trim().min(1).max(24, { error: 'Keep each tag under 24 characters.' }), { error: 'Tags must be a list.' })
  .max(5, { error: 'Use at most 5 tags.' });

const createBody = z.object({
  kind: z.enum(['place', 'product'], { error: 'Choose a place or a product.' }),
  name,
  veganStatus: z.enum(['fully_vegan', 'vegan_options', 'vegan_product'], { error: 'Choose a vegan status.' }).optional(),
  category: z.string().trim().max(40).optional(),
  area: z.string().optional(),
  stores: z.array(z.string()).optional(),
  summary: optionalText(SUMMARY_MAX, 'The summary'),
  whatToOrder: optionalText(BODY_MAX, 'What to order'),
  opinion: opinionValue.nullable().optional(),
  mapsUrl: mapsUrl.optional(),
  photoId: photoId.optional(),
});

const editBody = z.object({
  name: name.optional(),
  category: z.string().trim().max(40).optional(),
  area: area.optional(),
  stores: stores.optional(),
  veganStatus: z.enum(['fully_vegan', 'vegan_options', 'vegan_product'], { error: 'Choose a vegan status.' }).optional(),
  summary: optionalText(SUMMARY_MAX, 'The summary'),
  tags: tags.optional(),
  mapsUrl: z.union([mapsUrl, z.null()]).optional(),
  photoId: photoId.nullable().optional(),
});

const recommendationBody = z.object({
  body: optionalText(BODY_MAX, 'Your recommendation'),
  offer: optionalText(OFFER_MAX, 'The offer'),
  offerExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Choose the last day of the offer.' }).optional(),
  photoId: photoId.optional(),
});

const listQuery = z.object({
  kind: z.enum(['place', 'product', 'service'], { error: 'Unknown kind.' }).optional(),
  area: z.string().max(40).optional(),
  vegan_status: z.enum(['fully_vegan', 'vegan_options', 'vegan_product'], { error: 'Unknown vegan status.' }).optional(),
  category: z.string().max(40).optional(),
  store: z.string().max(40).optional(),
  has_offer: z.enum(['1', 'true', '0', 'false']).optional(),
  sort: z.enum(['top', 'new'], { error: 'Sort by top or new.' }).optional(),
  cursor: z.string().regex(/^\d{1,6}$/, { error: 'Bad cursor.' }).optional(),
  limit: z.string().regex(/^\d{1,2}$/).optional(),
});

const suggestQuery = z.object({
  q: z.string().max(NAME_MAX).optional(),
  kind: z.enum(['place', 'product', 'service']).optional(),
});

const cursorQuery = z.object({ cursor: z.string().regex(/^\d{1,6}$/, { error: 'Bad cursor.' }).optional() });

const slugParam = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const uuidParam = z.uuid();

// ---------- helpers ----------

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Today's date in Dubai as YYYY-MM-DD. */
export function dubaiToday(now = Date.now()): string {
  return new Date(now + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** End of a Dubai calendar day as a Date. */
function endOfDubaiDay(day: string): Date {
  const noon = Date.parse(`${day}T12:00:00Z`);
  // Rejects dates such as 2026-02-30, which Date would roll over.
  if (Number.isNaN(noon) || new Date(noon).toISOString().slice(0, 10) !== day) {
    fail(400, 'Choose a real date.', 'invalid_input', 'offerExpiresOn');
  }
  return new Date(`${day}T23:59:59.999+04:00`);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function slugify(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

function randomSuffix(): string {
  return randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-5);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const viewer = (res: Response): SessionUser | null => res.locals.session?.user ?? null;
const isAdmin = (u: SessionUser | null) => u?.role === 'admin';

const ACTIVE_OFFER = `r.offer IS NOT NULL AND r.offer_expires_at > now() AND NOT r.hidden`;

const CARD_SELECT = `
  SELECT l.id, l.kind, l.slug, l.name, l.category, l.area, l.stores, l.vegan_status, l.summary, l.tags, l.maps_url,
         l.owner_user_id, l.created_by, l.hidden, l.created_at, p.blob_path AS photo_path,
         coalesce(o.rec, 0) AS rec, coalesce(o.nfm, 0) AS nfm,
         (SELECT count(*) FROM recommendations r WHERE r.listing_id = l.id AND ${ACTIVE_OFFER}) AS offers
  FROM listings l
  LEFT JOIN photos p ON p.id = l.photo_id AND p.deleted_at IS NULL AND NOT p.hidden
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE value = 'recommend') AS rec, count(*) FILTER (WHERE value = 'not_for_me') AS nfm
    FROM opinions WHERE listing_id = l.id
  ) o ON true`;

interface CardRow {
  id: string;
  kind: ListingKind;
  slug: string;
  name: string;
  category: string;
  area: string | null;
  stores: string[];
  vegan_status: VeganStatus;
  summary: string;
  tags: string[];
  maps_url: string | null;
  owner_user_id: string | null;
  created_by: string;
  hidden: boolean;
  created_at: Date;
  photo_path: string | null;
  rec: number;
  nfm: number;
  offers: number;
}

function toCard(r: CardRow): ListingCard {
  return {
    id: r.id,
    kind: r.kind,
    slug: r.slug,
    name: r.name,
    category: r.category,
    area: r.area,
    stores: r.stores,
    veganStatus: r.vegan_status,
    summary: r.summary,
    photoUrl: r.photo_path ? mediaUrl(r.photo_path) : null,
    recommendCount: r.rec,
    notForMeCount: r.nfm,
    activeOfferCount: r.offers,
    runByOwner: r.owner_user_id !== null,
    hidden: r.hidden,
    createdAt: r.created_at.toISOString(),
  };
}

/** The listing behind a slug, or a 404. Hidden listings exist only for admins. */
async function findListing(db: Queryable, slug: string, user: SessionUser | null): Promise<CardRow> {
  const ok = slugParam.safeParse(slug);
  if (!ok.success) fail(404, 'That listing was not found.', 'not_found');
  const row = await db.maybeOne<CardRow>(`${CARD_SELECT} WHERE l.slug = $1`, [slug]);
  if (!row || (row.hidden && !isAdmin(user))) fail(404, 'That listing was not found.', 'not_found');
  return row;
}

async function activeOffers(db: Queryable, listingId: string): Promise<ActiveOffer[]> {
  const rows = await db.query<AuthorRow & { id: string; offer: string; offer_expires_at: Date; created_at: Date }>(
    `SELECT r.id, r.offer, r.offer_expires_at, r.created_at, ${authorCols('u', 'ap', 'a_')}
     FROM recommendations r JOIN users u ON u.id = r.user_id LEFT JOIN photos ap ON ap.id = u.avatar_photo_id AND ap.deleted_at IS NULL AND NOT ap.hidden
     WHERE r.listing_id = $1 AND ${ACTIVE_OFFER}
     ORDER BY r.created_at DESC LIMIT 10`,
    [listingId],
  );
  return rows.map((r) => ({
    recommendationId: r.id,
    offer: r.offer,
    offerExpiresAt: r.offer_expires_at.toISOString(),
    createdAt: r.created_at.toISOString(),
    author: toAuthor(r),
  }));
}

/**
 * The member who added a listing may edit it for 24 hours, but only while nobody else runs it:
 * once an admin gave it to an owner, or took ownership away, the creator's window is closed.
 */
async function creatorMayEdit(db: Queryable, row: CardRow, user: SessionUser | null): Promise<boolean> {
  if (!user || row.created_by !== user.id) return false;
  if (Date.now() - row.created_at.getTime() >= EDIT_WINDOW_HOURS * 3_600_000) return false;
  if (row.owner_user_id !== null && row.owner_user_id !== user.id) return false;
  const revoked = await db.maybeOne(`SELECT 1 FROM audit WHERE action = 'ownership.revoke' AND target_type = 'listing' AND target_id = $1 LIMIT 1`, [row.id]);
  return !revoked;
}

async function loadDetail(db: Queryable, row: CardRow, user: SessionUser | null): Promise<ListingDetail> {
  const author = await db.one<AuthorRow>(
    `SELECT ${authorCols('u', 'ap', 'a_')} FROM users u LEFT JOIN photos ap ON ap.id = u.avatar_photo_id AND ap.deleted_at IS NULL AND NOT ap.hidden WHERE u.id = $1`,
    [row.created_by],
  );
  let myOpinion: OpinionValue | null = null;
  let saved = false;
  if (user) {
    const mine = await db.maybeOne<{ value: OpinionValue; saved: boolean }>(
      `SELECT (SELECT value FROM opinions WHERE listing_id = $1 AND user_id = $2) AS value,
              EXISTS (SELECT 1 FROM bookmarks WHERE listing_id = $1 AND user_id = $2) AS saved`,
      [row.id, user.id],
    );
    myOpinion = mine?.value ?? null;
    saved = mine?.saved ?? false;
  }
  const mine = user?.id === row.created_by;
  return {
    ...toCard(row),
    tags: row.tags,
    mapsUrl: row.maps_url,
    createdBy: toAuthor(author),
    mine,
    canEdit: isAdmin(user) || (await creatorMayEdit(db, row, user)),
    myOpinion,
    saved,
    offers: await activeOffers(db, row.id),
  };
}

async function opinionCounts(db: Queryable, listingId: string, userId: string): Promise<OpinionCounts> {
  const r = await db.one<{ rec: number; nfm: number; mine: OpinionValue | null }>(
    `SELECT count(*) FILTER (WHERE value = 'recommend') AS rec, count(*) FILTER (WHERE value = 'not_for_me') AS nfm,
            max(value) FILTER (WHERE user_id = $2) AS mine
     FROM opinions WHERE listing_id = $1`,
    [listingId, userId],
  );
  return { recommendCount: r.rec, notForMeCount: r.nfm, myOpinion: r.mine };
}

/** A photo the member uploaded and has not deleted. */
async function ownPhoto(db: Queryable, id: string, userId: string): Promise<void> {
  const ok = await db.maybeOne('SELECT 1 FROM photos WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND NOT hidden', [id, userId]);
  if (!ok) fail(400, 'That photo is not available. Please add it again.', 'bad_photo', 'photoId');
}

interface RecRow extends AuthorRow {
  id: string;
  listing_id: string;
  user_id: string;
  body: string;
  offer: string | null;
  offer_expires_at: Date | null;
  photo_path: string | null;
  created_at: Date;
  upvotes: number;
  upvoted: boolean;
}

const REC_SELECT = `
  SELECT r.id, r.listing_id, r.user_id, r.body, r.offer, r.offer_expires_at, r.created_at, p.blob_path AS photo_path,
         (SELECT count(*) FROM upvotes v WHERE v.target_type = 'recommendation' AND v.target_id = r.id) AS upvotes,
         EXISTS (SELECT 1 FROM upvotes v WHERE v.target_type = 'recommendation' AND v.target_id = r.id AND v.user_id = $1) AS upvoted,
         ${authorCols('u', 'ap', 'a_')}
  FROM recommendations r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN photos ap ON ap.id = u.avatar_photo_id AND ap.deleted_at IS NULL AND NOT ap.hidden
  LEFT JOIN photos p ON p.id = r.photo_id AND p.deleted_at IS NULL AND NOT p.hidden`;

function toRecommendation(r: RecRow, user: SessionUser | null): Recommendation {
  return {
    id: r.id,
    listingId: r.listing_id,
    body: r.body,
    offer: r.offer,
    offerExpiresAt: r.offer_expires_at ? r.offer_expires_at.toISOString() : null,
    photoUrl: r.photo_path ? mediaUrl(r.photo_path) : null,
    upvotes: r.upvotes,
    upvotedByMe: r.upvoted,
    mine: user?.id === r.user_id,
    author: toAuthor(r),
    createdAt: r.created_at.toISOString(),
  };
}

// The nil uuid stands in for "no viewer" so the upvoted column is simply false.
const NO_USER = '00000000-0000-0000-0000-000000000000';

// ---------- router ----------

export function router(deps: Deps): Router {
  const r = Router();
  const { db } = deps;

  // ----- reads -----

  r.get('/listings', async (req, res) => {
    const q = parse(listQuery, req.query);
    const user = viewer(res);
    const where: string[] = [];
    const params: Param[] = [];
    const add = (sql: (n: string) => string, value: Param) => {
      params.push(value);
      where.push(sql(`$${params.length}`));
    };
    if (!isAdmin(user)) where.push('NOT l.hidden');
    if (q.kind) add((n) => `l.kind = ${n}`, q.kind);
    if (q.area) add((n) => `(l.area = ${n} OR (l.kind = 'service' AND l.area = 'Delivery only'))`, q.area);
    if (q.vegan_status) add((n) => `l.vegan_status = ${n}`, q.vegan_status);
    if (q.category) add((n) => `l.category = ${n}`, q.category);
    if (q.store) add((n) => `${n} = ANY (l.stores)`, q.store);
    if (q.has_offer === '1' || q.has_offer === 'true') {
      where.push(`EXISTS (SELECT 1 FROM recommendations r WHERE r.listing_id = l.id AND ${ACTIVE_OFFER})`);
    }
    const order = q.sort === 'new'
      ? 'l.created_at DESC, l.id DESC'
      : 'coalesce(o.rec, 0) DESC, (coalesce(o.rec, 0) - coalesce(o.nfm, 0)) DESC, l.created_at DESC, l.id DESC';
    const size = Math.min(Math.max(Number(q.limit ?? PAGE_SIZE), 1), 50);
    const offset = Number(q.cursor ?? 0);
    params.push(size + 1, offset);
    const rows = await db.query<CardRow>(
      `${CARD_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const page: Page<ListingCard> = {
      items: rows.slice(0, size).map(toCard),
      nextCursor: rows.length > size ? String(offset + size) : null,
    };
    res.json(page);
  });

  r.get('/listings/suggest', async (req, res) => {
    const q = parse(suggestQuery, req.query);
    const text = (q.q ?? '').trim().toLowerCase();
    if (text.length < 2) {
      res.json({ items: [] });
      return;
    }
    const user = viewer(res);
    const params: Param[] = [text, `${escapeLike(text)}%`, `% ${escapeLike(text)}%`];
    const filters = [isAdmin(user) ? 'true' : 'NOT l.hidden'];
    if (q.kind) {
      params.push(q.kind);
      filters.push(`l.kind = $${params.length}`);
    }
    const rows = await db.query<{ id: string; slug: string; kind: ListingKind; name: string; area: string | null; stores: string[]; vegan_status: VeganStatus }>(
      `WITH qq AS (SELECT vw_trigrams($1) AS grams)
       SELECT l.id, l.slug, l.kind, l.name, l.area, l.stores, l.vegan_status
       FROM (
         SELECT l.*, lower(l.name) LIKE $2 AS prefix, lower(l.name) LIKE $3 AS word,
                vw_trgm_cover(l.name_trgm, qq.grams) AS cover
         FROM listings l, qq
         WHERE (lower(l.name) LIKE $2 OR lower(l.name) LIKE $3 OR l.name_trgm && qq.grams)
       ) l
       WHERE ${filters.join(' AND ')} AND (l.prefix OR l.word OR l.cover >= 0.5)
       ORDER BY l.prefix DESC, l.word DESC, l.cover DESC, l.created_at DESC
       LIMIT 5`,
      params,
    );
    const items: ListingSuggestion[] = rows.map((x) => ({
      id: x.id, slug: x.slug, kind: x.kind, name: x.name, area: x.area, stores: x.stores, veganStatus: x.vegan_status,
    }));
    res.json({ items });
  });

  const dealsHandler = async (_req: unknown, res: Response) => {
    const rows = await db.query<AuthorRow & {
      id: string; offer: string; offer_expires_at: Date; created_at: Date;
      l_id: string; l_slug: string; l_kind: ListingKind; l_name: string; l_category: string; l_photo: string | null;
    }>(
      `SELECT r.id, r.offer, r.offer_expires_at, r.created_at,
              l.id AS l_id, l.slug AS l_slug, l.kind AS l_kind, l.name AS l_name, l.category AS l_category, lp.blob_path AS l_photo,
              ${authorCols('u', 'ap', 'a_')}
       FROM recommendations r
       JOIN listings l ON l.id = r.listing_id AND NOT l.hidden
       JOIN users u ON u.id = r.user_id
       LEFT JOIN photos ap ON ap.id = u.avatar_photo_id AND ap.deleted_at IS NULL AND NOT ap.hidden
       LEFT JOIN photos lp ON lp.id = l.photo_id AND lp.deleted_at IS NULL AND NOT lp.hidden
       WHERE ${ACTIVE_OFFER}
       ORDER BY r.created_at DESC
       LIMIT 20`,
    );
    const items: DealItem[] = rows.map((x) => ({
      recommendationId: x.id,
      offer: x.offer,
      offerExpiresAt: x.offer_expires_at.toISOString(),
      createdAt: x.created_at.toISOString(),
      author: toAuthor(x),
      listing: { id: x.l_id, slug: x.l_slug, kind: x.l_kind, name: x.l_name, category: x.l_category, photoUrl: x.l_photo ? mediaUrl(x.l_photo) : null },
    }));
    res.json({ items });
  };
  r.get('/listings/offers/active', dealsHandler);
  r.get('/offers/active', dealsHandler);

  r.get('/listings/:slug', async (req, res) => {
    const user = viewer(res);
    const resolved = await db.maybeOne<{ slug: string }>(
      `WITH RECURSIVE chain AS (
         SELECT id, slug, merged_into_id FROM listings WHERE slug = $1
         UNION ALL SELECT l.id, l.slug, l.merged_into_id FROM listings l JOIN chain c ON l.id = c.merged_into_id
       ) SELECT slug FROM chain WHERE merged_into_id IS NULL`, [String(req.params.slug)]);
    const row = await findListing(db, resolved?.slug ?? String(req.params.slug), user);
    res.json({ listing: await loadDetail(db, row, user) });
  });

  r.get('/listings/:slug/recommendations', async (req, res) => {
    const user = viewer(res);
    const listing = await findListing(db, String(req.params.slug), user);
    const { cursor } = parse(cursorQuery, req.query);
    const offset = Number(cursor ?? 0);
    const rows = await db.query<RecRow>(
      `${REC_SELECT}
       WHERE r.listing_id = $2 ${isAdmin(user) ? '' : 'AND NOT r.hidden'}
       ORDER BY upvotes DESC, r.created_at DESC, r.id DESC
       LIMIT $3 OFFSET $4`,
      [user?.id ?? NO_USER, listing.id, PAGE_SIZE + 1, offset],
    );
    const page: Page<Recommendation> = {
      items: rows.slice(0, PAGE_SIZE).map((x) => toRecommendation(x, user)),
      nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
    };
    res.json(page);
  });

  r.get('/bookmarks', requireUser, async (req, res) => {
    const user = currentUser(res);
    const { cursor } = parse(cursorQuery, req.query);
    const offset = Number(cursor ?? 0);
    const rows = await db.query<CardRow>(
      `${CARD_SELECT} JOIN bookmarks b ON b.listing_id = l.id AND b.user_id = $1
       ${isAdmin(user) ? '' : 'WHERE NOT l.hidden'}
       ORDER BY b.created_at DESC, l.id DESC LIMIT $2 OFFSET $3`,
      [user.id, PAGE_SIZE + 1, offset],
    );
    const page: Page<ListingCard> = {
      items: rows.slice(0, PAGE_SIZE).map(toCard),
      nextCursor: rows.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null,
    };
    res.json(page);
  });

  // ----- writes -----

  r.post('/listings', requireUser, async (req, res) => {
    const user = currentUser(res);
    const b = parse(createBody, req.body);
    let veganStatus: VeganStatus;
    let listingArea: string | null = null;
    let listingStores: string[] = [];
    let category = b.category ?? '';
    if (b.kind === 'place') {
      veganStatus = parse(placeStatus, b.veganStatus);
      listingArea = parse(area, b.area);
      if (category && !(PLACE_CATEGORIES as readonly string[]).includes(category)) fail(400, 'Choose a category from the list.', 'invalid_input', 'category');
    } else {
      if (b.veganStatus && b.veganStatus !== 'vegan_product') fail(400, 'A product is listed as a vegan product.', 'invalid_input', 'veganStatus');
      veganStatus = 'vegan_product';
      listingStores = parse(stores, b.stores);
      if (b.mapsUrl) fail(400, 'Maps links are for places only.', 'invalid_input', 'mapsUrl');
      if (category && !(PRODUCT_CATEGORIES as readonly string[]).includes(category)) fail(400, 'Choose a category from the list.', 'invalid_input', 'category');
    }
    category = category.trim();
    rejectContact(b.name, b.summary, b.whatToOrder);
    const opinion = b.opinion === undefined ? 'recommend' : b.opinion;
    const base = slugify(b.name) || b.kind;

    let slug = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        slug = await db.tx(async (q) => {
          await checkCap(q, user, 'listing');
          if (b.whatToOrder) await checkCap(q, user, 'post');
          if (b.photoId) await ownPhoto(q, b.photoId, user.id);
          const taken = attempt > 0 || Boolean(await q.maybeOne('SELECT 1 FROM listings WHERE slug = $1', [base]));
          const s = taken ? `${base.slice(0, 54)}-${randomSuffix()}` : base;
          const row = await q.one<{ id: string }>(
            `INSERT INTO listings (kind, name, slug, category, area, stores, vegan_status, summary, maps_url, photo_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [b.kind, b.name, s, category, listingArea, listingStores, veganStatus, b.summary ?? '', b.mapsUrl ?? null, b.photoId ?? null, user.id],
          );
          if (opinion) {
            await q.query('INSERT INTO opinions (listing_id, user_id, value) VALUES ($1, $2, $3)', [row.id, user.id, opinion]);
          }
          if (b.whatToOrder) {
            await q.query('INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, $3)', [row.id, user.id, b.whatToOrder]);
          }
          return s;
        });
        break;
      } catch (err) {
        if (isUniqueViolation(err, 'listings_slug_key') && attempt < 3) continue;
        throw err;
      }
    }
    const row = await findListing(db, slug, user);
    res.status(201).json({ listing: await loadDetail(db, row, user) });
  });

  r.patch('/listings/:slug', requireUser, async (req, res) => {
    const user = currentUser(res);
    const row = await findListing(db, String(req.params.slug), user);
    const admin = isAdmin(user);
    if (!admin && !(await creatorMayEdit(db, row, user))) {
      const fresh = Date.now() - row.created_at.getTime() < EDIT_WINDOW_HOURS * 3_600_000;
      fail(403, row.created_by !== user.id
        ? 'Only the member who added this can edit it.'
        : fresh
          ? 'This listing has an owner now, so only they or an admin can edit it.'
          : 'You can edit a listing for 24 hours after adding it. Add a recommendation instead.', 'not_allowed');
    }
    const b = parse(editBody, req.body);
    rejectContact(b.name, b.summary, b.category, ...(b.tags ?? []));
    const sets: string[] = [];
    const params: Param[] = [];
    const set = (col: string, value: Param) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (b.name !== undefined) set('name', b.name);
    if (b.summary !== undefined) set('summary', b.summary);
    if (b.tags !== undefined) set('tags', b.tags);
    if (b.category !== undefined) {
      const allowed: readonly string[] = row.kind === 'place' ? PLACE_CATEGORIES : row.kind === 'product' ? PRODUCT_CATEGORIES : SERVICE_CATEGORIES;
      // A service always has a category from its list, the same rule as PATCH /services/:id.
      if ((b.category || row.kind === 'service') && !allowed.includes(b.category)) fail(400, 'Choose a category from the list.', 'invalid_input', 'category');
      set('category', b.category);
    }
    if (b.area !== undefined) {
      if (row.kind !== 'place') fail(400, 'Only places have an area here.', 'invalid_input', 'area');
      set('area', b.area);
    }
    if (b.stores !== undefined) {
      if (row.kind !== 'product') fail(400, 'Only products have stores.', 'invalid_input', 'stores');
      set('stores', b.stores);
    }
    if (b.veganStatus !== undefined) {
      const ok = row.kind === 'product' ? b.veganStatus === 'vegan_product' : b.veganStatus !== 'vegan_product';
      if (!ok) fail(400, 'That vegan status does not fit this listing.', 'invalid_input', 'veganStatus');
      set('vegan_status', b.veganStatus);
    }
    if (b.mapsUrl !== undefined) {
      if (b.mapsUrl && row.kind === 'product') fail(400, 'Maps links are for places only.', 'invalid_input', 'mapsUrl');
      set('maps_url', b.mapsUrl ?? null);
    }
    if (b.photoId !== undefined) {
      if (b.photoId) await ownPhoto(db, b.photoId, user.id);
      set('photo_id', b.photoId);
    }
    if (sets.length) {
      params.push(row.id);
      await db.query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      if (row.created_by !== user.id) {
        await audit(db, { actorId: user.id, action: 'listing.edit', targetType: 'listing', targetId: row.id, detail: { fields: Object.keys(b) } });
      }
    }
    const updated = await findListing(db, row.slug, user);
    res.json({ listing: await loadDetail(db, updated, user) });
  });

  r.put('/listings/:slug/opinion', requireUser, async (req, res) => {
    const user = currentUser(res);
    const listing = await findListing(db, String(req.params.slug), user);
    const { value } = parse(z.object({ value: opinionValue }), req.body);
    await db.query(
      `INSERT INTO opinions (listing_id, user_id, value) VALUES ($1, $2, $3)
       ON CONFLICT (listing_id, user_id) DO UPDATE SET value = excluded.value, created_at = now()`,
      [listing.id, user.id, value],
    );
    res.json(await opinionCounts(db, listing.id, user.id));
  });

  r.delete('/listings/:slug/opinion', requireUser, async (req, res) => {
    const user = currentUser(res);
    const listing = await findListing(db, String(req.params.slug), user);
    await db.query('DELETE FROM opinions WHERE listing_id = $1 AND user_id = $2', [listing.id, user.id]);
    res.json(await opinionCounts(db, listing.id, user.id));
  });

  const setBookmark = async (listingId: string, userId: string, want: boolean | 'toggle'): Promise<boolean> => {
    const removed = want === true ? [] : await db.query(
      'DELETE FROM bookmarks WHERE user_id = $1 AND listing_id = $2 RETURNING listing_id',
      [userId, listingId],
    );
    const saved = want === true || (want === 'toggle' && removed.length === 0);
    if (saved) await db.query('INSERT INTO bookmarks (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, listingId]);
    return saved;
  };
  for (const [method, want] of [['post', 'toggle'], ['put', true], ['delete', false]] as const) {
    r[method]('/listings/:slug/bookmark', requireUser, async (req, res) => {
      const user = currentUser(res);
      const listing = await findListing(db, String(req.params.slug), user);
      res.json({ saved: await setBookmark(listing.id, user.id, want) });
    });
  }

  r.post('/listings/:slug/recommendations', requireUser, async (req, res) => {
    const user = currentUser(res);
    const listing = await findListing(db, String(req.params.slug), user);
    const b = parse(recommendationBody, req.body);
    const body = b.body ?? '';
    const offer = b.offer || null;
    if (!body && !offer) fail(400, 'Write what to order, or add an offer.', 'invalid_input', 'body');
    if (body && body.length < 3) fail(400, 'Write a little more, at least 3 characters.', 'invalid_input', 'body');
    let expires: Date | null = null;
    if (offer) {
      if (!b.offerExpiresOn) fail(400, 'Choose the last day of the offer.', 'invalid_input', 'offerExpiresOn');
      const today = dubaiToday();
      if (b.offerExpiresOn < today) fail(400, 'The last day of the offer is in the past.', 'invalid_input', 'offerExpiresOn');
      if (b.offerExpiresOn > addDays(today, OFFER_MAX_DAYS)) fail(400, `Offers can run for up to ${OFFER_MAX_DAYS} days.`, 'invalid_input', 'offerExpiresOn');
      expires = endOfDubaiDay(b.offerExpiresOn);
    } else if (b.offerExpiresOn) {
      fail(400, 'Add the offer text, or clear the date.', 'invalid_input', 'offer');
    }
    rejectContact(body, offer);
    const id = await db.tx(async (q) => {
      await checkCap(q, user, 'post');
      if (b.photoId) await ownPhoto(q, b.photoId, user.id);
      const row = await q.one<{ id: string }>(
        `INSERT INTO recommendations (listing_id, user_id, body, offer, offer_expires_at, photo_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [listing.id, user.id, body, offer, expires, b.photoId ?? null],
      );
      return row.id;
    });
    const row = await db.one<RecRow>(`${REC_SELECT} WHERE r.id = $2`, [user.id, id]);
    res.status(201).json({ recommendation: toRecommendation(row, user) });
  });

  const setUpvote = async (id: unknown, res: Response, want: boolean | 'toggle') => {
    const user = currentUser(res);
    const ok = uuidParam.safeParse(id);
    if (!ok.success) fail(404, 'That recommendation was not found.', 'not_found');
    const rec = await db.maybeOne<{ id: string; hidden: boolean; listing_hidden: boolean }>(
      `SELECT r.id, r.hidden, l.hidden AS listing_hidden FROM recommendations r JOIN listings l ON l.id = r.listing_id WHERE r.id = $1`,
      [ok.data],
    );
    if (!rec || ((rec.hidden || rec.listing_hidden) && !isAdmin(user))) fail(404, 'That recommendation was not found.', 'not_found');
    const removed = want === true ? [] : await db.query(
      `DELETE FROM upvotes WHERE target_type = 'recommendation' AND target_id = $1 AND user_id = $2 RETURNING user_id`,
      [rec.id, user.id],
    );
    const upvoted = want === true || (want === 'toggle' && removed.length === 0);
    if (upvoted) {
      await db.query(
        `INSERT INTO upvotes (target_type, target_id, user_id) VALUES ('recommendation', $1, $2) ON CONFLICT DO NOTHING`,
        [rec.id, user.id],
      );
    }
    const { n } = await db.one<{ n: number }>(
      `SELECT count(*) AS n FROM upvotes WHERE target_type = 'recommendation' AND target_id = $1`,
      [rec.id],
    );
    res.json({ upvoted, upvotes: n });
  };
  r.post('/recommendations/:id/upvote', requireUser, (req, res) => setUpvote(req.params.id, res, 'toggle'));
  r.put('/recommendations/:id/upvote', requireUser, (req, res) => setUpvote(req.params.id, res, true));
  r.delete('/recommendations/:id/upvote', requireUser, (req, res) => setUpvote(req.params.id, res, false));

  return r;
}
