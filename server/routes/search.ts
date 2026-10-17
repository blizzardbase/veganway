// Keyword search across everything. Works signed out. Hidden items never appear.
// Mounted at /api. This router owns: GET /search?q=&type=&offset=
//
// Postgres full text with websearch_to_tsquery('simple', q) over the generated tsvector columns of
// listings, recommendations, topics and replies, plus a case insensitive prefix match on listing names
// (and on each word of a name), so short or partial words like "tof" still find "Tofu Bar".
// A recommendation or reply that matches rolls up to its listing or topic.
import { Router } from 'express';
import type { Deps } from '../deps.js';
import { VISIBLE_PARENT } from './talk.js';
import { mediaUrl } from './photos.js';
import { SEARCH_MAX, SEARCH_TYPES, type ListingHit, type SearchGroup, type SearchResults, type SearchType, type TopicHit } from '../../shared/types/search.js';

const TOP = 3;
const PAGE = 30;

const KIND_OF: Record<Exclude<SearchType, 'discussions'>, ListingHit['kind']> = { places: 'place', products: 'product', services: 'service' };

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface ListingRow {
  id: string;
  kind: ListingHit['kind'];
  name: string;
  slug: string;
  category: string;
  area: string | null;
  vegan_status: string;
  summary: string;
  recommend_count: number;
  photo_path: string | null;
  rec_snippet: string | null;
  reply_snippet: string | null;
  self_match: boolean;
  total: number;
}

interface TopicRow {
  id: string;
  kind: TopicHit['kind'];
  title: string;
  body: string | null;
  reply_snippet: string | null;
  self_match: boolean;
  reply_count: number;
}

// $1 = q, $2 = name prefix pattern, $3 = word prefix pattern, $4 = kinds, $5 = per kind limit, $6 = offset
const LISTINGS_SQL = `
WITH tsq AS (SELECT websearch_to_tsquery('simple', $1) AS q),
hits AS (
  SELECT l.*,
    (l.search @@ tsq.q OR l.name ILIKE $2 OR l.name ILIKE $3) AS self_match,
    (SELECT r.body FROM recommendations r WHERE r.listing_id = l.id AND NOT r.hidden AND r.search @@ tsq.q
       ORDER BY ts_rank(r.search, tsq.q) DESC, r.created_at DESC LIMIT 1) AS rec_snippet,
    (SELECT x.body FROM replies x WHERE x.target_type = 'listing' AND x.target_id = l.id AND NOT x.hidden AND x.deleted_at IS NULL AND ${VISIBLE_PARENT('x')} AND x.search @@ tsq.q
       ORDER BY x.created_at DESC LIMIT 1) AS reply_snippet,
    ts_rank(l.search, tsq.q)
      + CASE WHEN l.name ILIKE $2 THEN 1.0 WHEN l.name ILIKE $3 THEN 0.5 ELSE 0 END AS rank
  FROM listings l, tsq
  WHERE NOT l.hidden AND l.kind = ANY($4::text[])
),
matched AS (
  SELECT h.*,
    (SELECT count(*) FROM opinions o WHERE o.listing_id = h.id AND o.value = 'recommend') AS recommend_count,
    (SELECT p.blob_path FROM photos p WHERE p.id = h.photo_id AND p.deleted_at IS NULL AND NOT p.hidden) AS photo_path,
    row_number() OVER (PARTITION BY h.kind ORDER BY h.self_match DESC, h.rank DESC, h.created_at DESC, h.id DESC) AS rn,
    count(*) OVER (PARTITION BY h.kind) AS total
  FROM hits h
  WHERE h.self_match OR h.rec_snippet IS NOT NULL OR h.reply_snippet IS NOT NULL
)
SELECT id, kind, name, slug, category, area, vegan_status, summary, recommend_count, photo_path, rec_snippet, reply_snippet, self_match, total
FROM matched WHERE rn > $6 AND rn <= $6 + $5 ORDER BY kind, rn`;

// $1 = q, $2 = limit, $3 = offset
const TOPICS_SQL = `
WITH tsq AS (SELECT websearch_to_tsquery('simple', $1) AS q),
hits AS (
  SELECT t.id, t.kind, t.title, t.body, t.created_at,
    (t.search @@ tsq.q) AS self_match,
    (SELECT x.body FROM replies x WHERE x.target_type = 'topic' AND x.target_id = t.id AND NOT x.hidden AND x.deleted_at IS NULL AND ${VISIBLE_PARENT('x')} AND x.search @@ tsq.q
       ORDER BY x.created_at DESC LIMIT 1) AS reply_snippet,
    ts_rank(t.search, tsq.q) AS rank
  FROM topics t, tsq
  WHERE NOT t.hidden
), matched AS (
  SELECT * FROM hits WHERE self_match OR reply_snippet IS NOT NULL
), page AS (
  SELECT h.id, h.kind, h.title, h.body, h.reply_snippet, h.self_match,
    (SELECT count(*) FROM replies x WHERE x.target_type = 'topic' AND x.target_id = h.id AND NOT x.hidden AND x.deleted_at IS NULL AND ${VISIBLE_PARENT('x')}) AS reply_count
  FROM matched h
  ORDER BY h.self_match DESC, h.rank DESC, h.created_at DESC, h.id DESC
  LIMIT $2 OFFSET $3
)
SELECT (SELECT count(*)::int FROM matched) AS total,
  coalesce((SELECT json_agg(page) FROM page), '[]'::json) AS items`;

const clip = (text: string | null, max = 180): string | null => {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || null;
};

function toListingHit(r: ListingRow): ListingHit {
  const via: ListingHit['matchedVia'] = r.self_match ? 'listing' : r.rec_snippet ? 'recommendation' : 'reply';
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    slug: r.slug,
    category: r.category,
    area: r.area,
    veganStatus: r.vegan_status,
    recommendCount: r.recommend_count,
    photoUrl: r.photo_path ? mediaUrl(r.photo_path) : null,
    snippet: clip(via === 'listing' ? r.summary || r.rec_snippet : via === 'recommendation' ? r.rec_snippet : r.reply_snippet),
    matchedVia: via,
  };
}

function toTopicHit(r: TopicRow): TopicHit {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    snippet: clip(r.self_match ? r.body : r.reply_snippet),
    replyCount: r.reply_count,
    matchedVia: r.self_match ? 'topic' : 'reply',
  };
}

const empty = <T>(): SearchGroup<T> => ({ total: 0, items: [] });

export function router(deps: Deps): Router {
  const r = Router();
  const { db } = deps;

  r.get('/search', async (req, res) => {
    const raw = typeof req.query.q === 'string' ? req.query.q : '';
    const q = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX);
    const type = SEARCH_TYPES.includes(req.query.type as SearchType) ? (req.query.type as SearchType) : null;
    const requestedOffset = Number(req.query.offset ?? 0);
    const offset = Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? Math.min(requestedOffset, 1000) : 0;
    const out: SearchResults = { q, places: empty(), products: empty(), services: empty(), discussions: empty() };
    if (!q) {
      res.json(out);
      return;
    }

    const prefix = `${escapeLike(q)}%`;
    const wordPrefix = `% ${escapeLike(q)}%`;
    const perKind = type ? PAGE : TOP;
    const listingKinds = type ? (type === 'discussions' ? [] : [KIND_OF[type]]) : Object.values(KIND_OF);

    if (listingKinds.length) {
      const rows = await db.query<ListingRow>(LISTINGS_SQL, [q, prefix, wordPrefix, listingKinds, perKind, type ? offset : 0]);
      for (const [group, kind] of Object.entries(KIND_OF) as [Exclude<SearchType, 'discussions'>, ListingHit['kind']][]) {
        const mine = rows.filter((x) => x.kind === kind);
        out[group] = { total: mine[0]?.total ?? 0, items: mine.map(toListingHit) };
      }
      // A page past the end has no rows to carry the total; count it once more.
      if (type && type !== 'discussions' && !rows.length && offset > 0) {
        const again = await db.query<ListingRow>(LISTINGS_SQL, [q, prefix, wordPrefix, listingKinds, 1, 0]);
        out[type].total = again[0]?.total ?? 0;
      }
    }
    if (!type || type === 'discussions') {
      const page = await db.one<{ total: number; items: TopicRow[] }>(TOPICS_SQL, [q, type ? PAGE : TOP, type ? offset : 0]);
      out.discussions = { total: page.total, items: page.items.map(toTopicHit) };
    }
    res.json(out);
  });

  return r;
}
