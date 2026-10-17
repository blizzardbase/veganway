// Home feed. Spec sections 6.5 and 7. Mounted at /api. This router owns:
//   GET /feed?cursor=&limit=   one newest first stream of new listings, recommendations and topics
//   GET /feed/pinned           pinned topics, for the cards above the feed
// Reads work signed out. Hidden listings, recommendations and topics never appear, for anyone.
// Noise is collapsed: recommendations on one listing less than an hour apart become one item with a
// count, and the creator's "what to order" written while adding a listing rides on the listing item.
// Pinned topics show above the feed, so the stream leaves them out.
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { Param, Queryable } from '../db.js';
import { fail, parse } from '../lib/http.js';
import { mediaUrl } from './photos.js';
import { loadPolls, toSummary, topicColumns, type TopicRow } from './talk.js';
import type { Author, ListingKind, VeganStatus } from '../../shared/types/listings.js';
import {
  FEED_COLLAPSE_MINUTES, FEED_EXCERPT_MAX, FEED_PAGE_MAX, FEED_PAGE_SIZE, FEED_PINNED_MAX,
  type FeedItem, type FeedListing, type FeedPage, type PinnedResponse,
} from '../../shared/types/feed.js';

const KEY = /^(listing|rec|topic):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const feedQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number({ error: 'Bad page size.' }).int().min(1).max(FEED_PAGE_MAX).default(FEED_PAGE_SIZE),
});

/** Position after the last item of a page: its time in microseconds and its key, the tie breaker. */
interface Cursor { u: number; k: string }

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (Number.isSafeInteger(c.u) && typeof c.k === 'string' && KEY.test(c.k)) return { u: c.u as number, k: c.k };
  } catch {
    // Fall through.
  }
  fail(400, 'That page link is not valid. Please refresh.', 'bad_cursor');
}

function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > FEED_EXCERPT_MAX ? `${flat.slice(0, FEED_EXCERPT_MAX - 1).trimEnd()}…` : flat;
}

// ---------- the stream ----------

/**
 * Every feed event, newest first. Times are compared in whole microseconds, Postgres' own precision,
 * so a cursor never drops or repeats an item that shares a millisecond with another.
 * $1 cursor micros or null, $2 cursor key or null, $3 page size plus one.
 */
const STREAM_SQL = `
WITH recs AS (
  SELECT r.id, r.listing_id, r.user_id, r.created_at,
         CASE WHEN lag(r.created_at) OVER w IS NULL
                OR r.created_at - lag(r.created_at) OVER w >= make_interval(mins => ${FEED_COLLAPSE_MINUTES})
              THEN 1 ELSE 0 END AS starts
  FROM recommendations r
  JOIN listings l ON l.id = r.listing_id
  WHERE NOT r.hidden AND NOT l.hidden
    -- The creator's first take, written in the same transaction as the listing, belongs to the listing item.
    AND NOT (r.user_id = l.created_by AND r.created_at = l.created_at)
  WINDOW w AS (PARTITION BY r.listing_id ORDER BY r.created_at, r.id)
),
numbered AS (
  SELECT recs.*, sum(starts) OVER (PARTITION BY listing_id ORDER BY created_at, id) AS grp FROM recs
),
groups AS (
  SELECT listing_id, count(*) AS n, max(created_at) AS at,
         (array_agg(id ORDER BY created_at, id))[1] AS first_id,
         (array_agg(id ORDER BY created_at DESC, id DESC))[1] AS last_id,
         array_agg(user_id ORDER BY created_at DESC, id DESC) AS user_ids
  FROM numbered GROUP BY listing_id, grp
),
events AS (
  SELECT 'listing:' || l.id::text AS key, 'listing_added' AS type, l.created_at AS at,
         l.id AS listing_id, NULL::uuid AS rec_id, NULL::uuid AS topic_id, 1::bigint AS n, NULL::uuid[] AS user_ids
  FROM listings l WHERE NOT l.hidden
  UNION ALL
  SELECT 'rec:' || g.first_id::text, 'recommendation', g.at, g.listing_id, g.last_id, NULL::uuid, g.n, g.user_ids
  FROM groups g
  UNION ALL
  SELECT 'topic:' || t.id::text, 'topic', t.created_at, NULL::uuid, NULL::uuid, t.id, 1::bigint, NULL::uuid[]
  FROM topics t WHERE NOT t.hidden AND NOT t.pinned
),
timed AS (
  SELECT events.*, (extract(epoch FROM at) * 1000000)::bigint AS at_us FROM events
)
SELECT key, type, at, at_us, listing_id, rec_id, topic_id, n, user_ids
FROM timed
WHERE $1::bigint IS NULL OR (at_us, key) < ($1::bigint, $2::text)
ORDER BY at_us DESC, key DESC
LIMIT $3`;

interface EventRow {
  key: string;
  type: 'listing_added' | 'recommendation' | 'topic';
  at: Date;
  at_us: number;
  listing_id: string | null;
  rec_id: string | null;
  topic_id: string | null;
  n: number;
  user_ids: string[] | null;
}

// ---------- hydration ----------

/** Author columns for users alias u and avatar alias ap. Deleted accounts read "Former member". */
const AUTHOR_COLS = `
  CASE WHEN u.deleted_at IS NOT NULL THEN 'Former member' ELSE u.pseudonym END AS a_pseudonym,
  CASE WHEN u.deleted_at IS NULL AND NOT u.profile_hidden THEN u.display_name END AS a_display_name,
  CASE WHEN u.deleted_at IS NULL AND NOT u.profile_hidden THEN ap.blob_path END AS a_avatar_path`;

interface AuthorRow {
  a_pseudonym: string;
  a_display_name: string | null;
  a_avatar_path: string | null;
}

function toAuthor(r: AuthorRow): Author {
  return { pseudonym: r.a_pseudonym, displayName: r.a_display_name, avatarUrl: r.a_avatar_path ? mediaUrl(r.a_avatar_path) : null };
}

interface ListingRow extends AuthorRow {
  id: string;
  slug: string;
  kind: ListingKind;
  name: string;
  category: string;
  area: string | null;
  stores: string[];
  vegan_status: VeganStatus;
  summary: string;
  photo_path: string | null;
  owner_user_id: string | null;
  rec: number;
  offers: number;
  first_take: string | null;
}

async function loadListings(db: Queryable, ids: string[]): Promise<Map<string, ListingRow>> {
  if (!ids.length) return new Map();
  const rows = await db.query<ListingRow>(
    `SELECT l.id, l.slug, l.kind, l.name, l.category, l.area, l.stores, l.vegan_status, l.summary, l.owner_user_id,
            p.blob_path AS photo_path,
            (SELECT count(*) FROM opinions o WHERE o.listing_id = l.id AND o.value = 'recommend') AS rec,
            (SELECT count(*) FROM recommendations r
              WHERE r.listing_id = l.id AND r.offer IS NOT NULL AND r.offer_expires_at > now() AND NOT r.hidden) AS offers,
            (SELECT nullif(r.body, '') FROM recommendations r
              WHERE r.listing_id = l.id AND r.user_id = l.created_by AND r.created_at = l.created_at AND NOT r.hidden
              ORDER BY r.id LIMIT 1) AS first_take,
            ${AUTHOR_COLS}
     FROM listings l
     JOIN users u ON u.id = l.created_by
     LEFT JOIN photos ap ON ap.id = u.avatar_photo_id AND ap.deleted_at IS NULL
     LEFT JOIN photos p ON p.id = l.photo_id AND p.deleted_at IS NULL
     WHERE l.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

function toFeedListing(r: ListingRow): FeedListing {
  return {
    id: r.id,
    slug: r.slug,
    kind: r.kind,
    name: r.name,
    category: r.category,
    area: r.area,
    stores: r.stores,
    veganStatus: r.vegan_status,
    photoUrl: r.photo_path ? mediaUrl(r.photo_path) : null,
    recommendCount: r.rec,
    activeOfferCount: r.offers,
    runByOwner: r.owner_user_id !== null,
  };
}

interface RecRow extends AuthorRow {
  id: string;
  body: string;
  offer: string | null;
  offer_expires_at: Date | null;
  offer_live: boolean;
  photo_path: string | null;
  upvotes: number;
  upvoted: boolean;
}

async function loadRecs(db: Queryable, ids: string[], viewerId: string | null): Promise<Map<string, RecRow>> {
  if (!ids.length) return new Map();
  const rows = await db.query<RecRow>(
    `SELECT r.id, r.body, r.offer, r.offer_expires_at, (r.offer IS NOT NULL AND r.offer_expires_at > now()) AS offer_live,
            p.blob_path AS photo_path,
            (SELECT count(*) FROM upvotes v WHERE v.target_type = 'recommendation' AND v.target_id = r.id) AS upvotes,
            EXISTS (SELECT 1 FROM upvotes v WHERE v.target_type = 'recommendation' AND v.target_id = r.id AND v.user_id = $2::uuid) AS upvoted,
            ${AUTHOR_COLS}
     FROM recommendations r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN photos ap ON ap.id = u.avatar_photo_id AND ap.deleted_at IS NULL
     LEFT JOIN photos p ON p.id = r.photo_id AND p.deleted_at IS NULL
     WHERE r.id = ANY($1::uuid[])`,
    [ids, viewerId],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function loadNames(db: Queryable, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.query<{ id: string; name: string }>(
    `SELECT id, CASE WHEN deleted_at IS NOT NULL THEN 'Former member' ELSE pseudonym END AS name FROM users WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function loadTopics(db: Queryable, ids: string[], viewerId: string | null) {
  if (!ids.length) return new Map<string, ReturnType<typeof toSummary>>();
  const rows = await db.query<TopicRow>(
    `SELECT ${topicColumns('$2::uuid')} FROM topics t JOIN users u ON u.id = t.user_id WHERE t.id = ANY($1::uuid[])`,
    [ids, viewerId],
  );
  const polls = await loadPolls(db, rows, viewerId);
  return new Map(rows.map((r) => [r.id, toSummary(r, polls.get(r.id) ?? null, false)]));
}

const viewerId = (res: Response): string | null => res.locals.session?.user.id ?? null;

// ---------- router ----------

export function router(deps: Deps): Router {
  const r = Router();
  const { db } = deps;

  r.get('/feed', async (req, res) => {
    const q = parse(feedQuery, req.query);
    const cursor = decodeCursor(q.cursor);
    const me = viewerId(res);
    const params: Param[] = [cursor?.u ?? null, cursor?.k ?? null, q.limit + 1];
    const rows = await db.query<EventRow>(STREAM_SQL, params);
    const page = rows.slice(0, q.limit);

    const listingIds = [...new Set(page.map((e) => e.listing_id).filter((v): v is string => Boolean(v)))];
    const recIds = page.map((e) => e.rec_id).filter((v): v is string => Boolean(v));
    const topicIds = page.map((e) => e.topic_id).filter((v): v is string => Boolean(v));
    const userIds = [...new Set(page.flatMap((e) => e.user_ids ?? []))];
    const [listings, recs, topics, names] = await Promise.all([
      loadListings(db, listingIds),
      loadRecs(db, recIds, me),
      loadTopics(db, topicIds, me),
      loadNames(db, userIds),
    ]);

    const items: FeedItem[] = [];
    for (const e of page) {
      const id = e.key;
      const at = e.at.toISOString();
      if (e.type === 'topic') {
        const topic = topics.get(e.topic_id!);
        if (topic) items.push({ type: 'topic', id, at, topic });
        continue;
      }
      const l = listings.get(e.listing_id!);
      if (!l) continue;
      if (e.type === 'listing_added') {
        items.push({
          type: 'listing_added', id, at,
          listing: { ...toFeedListing(l), summary: l.summary },
          addedBy: toAuthor(l),
          whatToOrder: l.first_take ? excerptOf(l.first_take) : null,
        });
        continue;
      }
      const rec = recs.get(e.rec_id!);
      if (!rec) continue;
      const authors = [...new Set((e.user_ids ?? []).map((u) => names.get(u)).filter((v): v is string => Boolean(v)))].slice(0, 3);
      items.push({
        type: 'recommendation', id, at,
        listing: toFeedListing(l),
        recommendation: {
          id: rec.id,
          excerpt: excerptOf(rec.body),
          author: toAuthor(rec),
          photoUrl: rec.photo_path ? mediaUrl(rec.photo_path) : null,
          upvotes: rec.upvotes,
          upvotedByMe: rec.upvoted,
          offer: rec.offer_live ? rec.offer : null,
          offerExpiresAt: rec.offer_live && rec.offer_expires_at ? rec.offer_expires_at.toISOString() : null,
        },
        count: e.n,
        authors,
      });
    }

    const last = page[page.length - 1];
    const body: FeedPage = {
      items,
      nextCursor: rows.length > q.limit && last ? encodeCursor({ u: last.at_us, k: last.key }) : null,
    };
    res.json(body);
  });

  r.get('/feed/pinned', async (_req, res) => {
    const me = viewerId(res);
    const rows = await db.query<TopicRow>(
      `SELECT ${topicColumns('$1::uuid')} FROM topics t JOIN users u ON u.id = t.user_id
       WHERE t.pinned AND NOT t.hidden
       ORDER BY t.created_at DESC, t.id DESC LIMIT ${FEED_PINNED_MAX}`,
      [me],
    );
    const polls = await loadPolls(db, rows, me);
    const body: PinnedResponse = { items: rows.map((row) => toSummary(row, polls.get(row.id) ?? null, false)) };
    res.json(body);
  });

  return r;
}

