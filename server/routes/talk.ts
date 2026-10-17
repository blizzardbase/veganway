// Talk slice: discussions, polls, replies and upvotes. Spec sections 4, 6.9 and 6.10.
// Mounted at /api. This router owns everything under /api/talk:
//   GET    /talk/topics?sort=hot|new&tag=&cursor=&limit=   list, pinned first, cursor pagination
//   GET    /talk/tags                                       most used tags for the filter chips
//   GET    /talk/topics/:id                                 one topic with its poll and linked listings
//   POST   /talk/topics                                     create a discussion or a poll
//   POST   /talk/topics/:id/vote                            set or change a poll vote until close
//   DELETE /talk/topics/:id/vote                            withdraw a vote until close (Undo)
//   POST   /talk/topics/:id/upvote                          toggle an upvote
//   POST   /talk/topics/:id/pin                             admin: pin or unpin
//   GET    /talk/linked?listing_id=                         up to 3 topics that link a listing
//   GET    /talk/replies?target_type=&target_id=            the reply thread of a listing or topic
//   POST   /talk/replies                                    reply, one level deep
//   DELETE /talk/replies/:id                                soft delete your own reply
//   POST   /talk/replies/:id/upvote                         toggle an upvote
// Reads work signed out. Hidden items are never shown to anyone but admins.
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { Param, Queryable } from '../db.js';
import { audit } from '../lib/audit.js';
import { currentUser, requireAdmin, requireUser, type SessionUser } from '../lib/auth.js';
import { CAPS, checkCap, isFreshAccount, lockCaps } from '../lib/caps.js';
import { rejectContact } from '../lib/contact.js';
import { fail, parse } from '../lib/http.js';
import {
  normalizeTag, POLL_DAYS_DEFAULT, POLL_DAYS_MAX, POLL_OPTION_MAX, POLL_OPTIONS_MAX, POLL_OPTIONS_MIN, REPLY_MAX, TAG_MAX,
  TOPIC_BODY_MAX, TOPIC_LISTINGS_MAX, TOPIC_TAGS_MAX, TOPIC_TITLE_MAX, TOPIC_TITLE_MIN,
  type LinkedListing, type LinkedTopicsResponse, type PinResponse, type Poll, type RepliesResponse, type Reply,
  type ReplyResponse, type ReplyThread, type TagsResponse, type TopicDetail, type TopicListResponse, type TopicResponse,
  type TopicSummary, type UpvoteResponse, type VoteResponse,
} from '../../shared/types/talk.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;
const EXCERPT_MAX = 160;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- input ----------

const id = z.string({ error: 'That item was not found.' }).regex(GUID, { error: 'That item was not found.' });

const title = z.string({ error: 'Add a title.' }).trim()
  .min(TOPIC_TITLE_MIN, { error: `Use at least ${TOPIC_TITLE_MIN} characters for the title.` })
  .max(TOPIC_TITLE_MAX, { error: `Keep the title under ${TOPIC_TITLE_MAX} characters.` });

const body = z.string({ error: 'That text is not valid.' }).trim()
  .max(TOPIC_BODY_MAX, { error: `Keep the text under ${TOPIC_BODY_MAX} characters.` })
  .nullish()
  .transform((v) => (v ? v : null));

const tag = z.string({ error: 'That tag is not valid.' }).transform(normalizeTag)
  .pipe(z.string().min(1, { error: 'A tag cannot be empty.' }).max(TAG_MAX, { error: `Keep each tag under ${TAG_MAX} characters.` })
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} &'-]*$/u, { error: 'Tags can use letters, numbers and spaces.' }));

const tags = z.array(tag, { error: 'Tags must be a list.' })
  .transform((list) => [...new Set(list)])
  .pipe(z.array(z.string()).max(TOPIC_TAGS_MAX, { error: `Use at most ${TOPIC_TAGS_MAX} tags.` }))
  .default([]);

const listingIds = z.array(id, { error: 'Linked places must be a list.' })
  .transform((list) => [...new Set(list.map((v) => v.toLowerCase()))])
  .pipe(z.array(z.string()).max(TOPIC_LISTINGS_MAX, { error: `Link at most ${TOPIC_LISTINGS_MAX} places, products or services.` }))
  .default([]);

const option = z.string({ error: 'Each option needs text.' }).trim()
  .min(1, { error: 'Each option needs text.' })
  .max(POLL_OPTION_MAX, { error: `Keep each option under ${POLL_OPTION_MAX} characters.` });

const discussionBody = z.object({ kind: z.literal('discussion'), title, body, tags, listingIds });
const pollBody = z.object({
  kind: z.literal('poll'),
  title,
  body,
  tags,
  listingIds,
  options: z.array(option, { error: 'Add the poll options.' })
    .min(POLL_OPTIONS_MIN, { error: `A poll needs at least ${POLL_OPTIONS_MIN} options.` })
    .max(POLL_OPTIONS_MAX, { error: `A poll can have at most ${POLL_OPTIONS_MAX} options.` })
    .refine((list) => new Set(list.map((o) => o.toLowerCase())).size === list.length, { error: 'Each option must be different.' }),
  durationDays: z.number({ error: 'Pick how long the poll runs.' }).int({ error: 'Pick how long the poll runs.' })
    .min(1, { error: 'A poll runs for at least 1 day.' })
    .max(POLL_DAYS_MAX, { error: `A poll runs for at most ${POLL_DAYS_MAX} days.` })
    .optional(),
  closesAt: z.iso.datetime({ offset: true, error: 'Pick when the poll closes.' }).optional(),
});
const createTopic = z.discriminatedUnion('kind', [discussionBody, pollBody], { error: 'Choose a discussion or a poll.' });

const voteBody = z.object({ optionId: id });
const pinBody = z.object({ pinned: z.boolean({ error: 'Say whether to pin.' }).optional() });

const replyBody = z.object({
  targetType: z.enum(['listing', 'topic'], { error: 'That item was not found.' }),
  targetId: id,
  parentId: id.nullish(),
  body: z.string({ error: 'Write a reply first.' }).trim()
    .min(1, { error: 'Write a reply first.' })
    .max(REPLY_MAX, { error: `Keep your reply under ${REPLY_MAX} characters.` }),
});

const repliesQuery = z.object({
  target_type: z.enum(['listing', 'topic'], { error: 'That item was not found.' }),
  target_id: id,
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});

const listQuery = z.object({
  sort: z.enum(['hot', 'new'], { error: 'Sort by hot or new.' }).default('hot'),
  tag: z.string().optional().transform((v) => (v ? normalizeTag(v) : null)),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});

type Cursor = { k: 'new'; id: string } | { k: 'hot'; o: number; t: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string | undefined, sort: 'hot' | 'new'): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<{ k: string; id: string; o: number; t: string }>;
    if (sort === 'new' && c.k === 'new' && typeof c.id === 'string' && GUID.test(c.id)) return { k: 'new', id: c.id };
    if (sort === 'hot' && c.k === 'hot' && Number.isInteger(c.o) && (c.o as number) >= 0 && typeof c.t === 'string' && !Number.isNaN(Date.parse(c.t))) {
      return { k: 'hot', o: c.o as number, t: c.t };
    }
  } catch {
    // Fall through.
  }
  fail(400, 'That page link is not valid. Please refresh.', 'bad_cursor');
}

function routeId(raw: unknown): string {
  if (typeof raw !== 'string' || !GUID.test(raw)) fail(404, 'That item was not found.', 'not_found');
  return raw.toLowerCase();
}

// ---------- rows ----------

export interface TopicRow {
  id: string;
  kind: 'discussion' | 'poll';
  title: string;
  body: string | null;
  tags: string[];
  listing_ids: string[];
  pinned: boolean;
  closes_at: Date | null;
  closed: boolean;
  created_at: Date;
  hidden: boolean;
  pseudonym: string;
  former: boolean;
  mine: boolean;
  upvotes: number;
  reply_count: number;
  upvoted: boolean;
}

/** Columns for TopicRow. $me must be bound to the viewer's id (or null) as the given placeholder. */
export function topicColumns(me: string): string {
  return `t.id, t.kind, t.title, t.body, t.tags, t.listing_ids, t.pinned, t.closes_at, t.created_at, t.hidden,
    (t.closes_at IS NOT NULL AND t.closes_at <= now()) AS closed,
    u.pseudonym, (u.deleted_at IS NOT NULL) AS former,
    coalesce(t.user_id = ${me}, false) AS mine,
    (SELECT count(*) FROM upvotes v WHERE v.target_type = 'topic' AND v.target_id = t.id) AS upvotes,
    (SELECT count(*) FROM replies r WHERE r.target_type = 'topic' AND r.target_id = t.id AND NOT r.hidden AND r.deleted_at IS NULL
       AND ${VISIBLE_PARENT('r')}) AS reply_count,
    EXISTS (SELECT 1 FROM upvotes v WHERE v.target_type = 'topic' AND v.target_id = t.id AND v.user_id = ${me}) AS upvoted`;
}

/** SQL: the reply under alias x is top level, or its parent is not hidden. A hidden parent hides its answers. */
export const VISIBLE_PARENT = (x: string) => `(${x}.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM replies hp WHERE hp.id = ${x}.parent_id AND hp.hidden))`;

function excerptOf(text: string | null): string {
  if (!text) return '';
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > EXCERPT_MAX ? `${line.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : line;
}

function authorOf(pseudonym: string, former: boolean) {
  return former ? { name: 'Former member', former: true } : { name: pseudonym, former: false };
}

export function toSummary(r: TopicRow, poll: Poll | null, isAdmin: boolean): TopicSummary {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    excerpt: excerptOf(r.body),
    tags: r.tags,
    pinned: r.pinned,
    author: authorOf(r.pseudonym, r.former),
    createdAt: r.created_at.toISOString(),
    replyCount: r.reply_count,
    upvotes: r.upvotes,
    upvoted: r.upvoted,
    mine: r.mine,
    ...(isAdmin && r.hidden ? { hidden: true } : {}),
    poll,
  };
}

/** Poll blocks for the given poll topics, keyed by topic id. Results only after a vote or after close. */
export async function loadPolls(db: Queryable, rows: Pick<TopicRow, 'id' | 'kind' | 'closes_at' | 'closed'>[], userId: string | null): Promise<Map<string, Poll>> {
  const polls = rows.filter((r) => r.kind === 'poll');
  const out = new Map<string, Poll>();
  if (!polls.length) return out;
  const ids = polls.map((r) => r.id);
  const options = await db.query<{ topic_id: string; id: string; label: string; votes: number }>(
    `SELECT o.topic_id, o.id, o.label, count(v.user_id) AS votes
     FROM poll_options o LEFT JOIN poll_votes v ON v.option_id = o.id
     WHERE o.topic_id = ANY($1::uuid[])
     GROUP BY o.topic_id, o.id, o.label, o.position
     ORDER BY o.topic_id, o.position`,
    [ids],
  );
  const mine = userId
    ? await db.query<{ topic_id: string; option_id: string }>(
      'SELECT topic_id, option_id FROM poll_votes WHERE user_id = $1 AND topic_id = ANY($2::uuid[])',
      [userId, ids],
    )
    : [];
  const myVotes = new Map(mine.map((v) => [v.topic_id, v.option_id]));
  for (const r of polls) {
    const opts = options.filter((o) => o.topic_id === r.id);
    const myVote = myVotes.get(r.id) ?? null;
    const resultsVisible = myVote !== null || r.closed;
    out.set(r.id, {
      options: opts.map((o) => (resultsVisible ? { id: o.id, label: o.label, votes: o.votes } : { id: o.id, label: o.label })),
      // The total would leak how a two option poll is going, so it is hidden with the results.
      ...(resultsVisible ? { totalVotes: opts.reduce((n, o) => n + o.votes, 0) } : {}),
      myVote,
      closesAt: (r.closes_at ?? new Date()).toISOString(),
      closed: r.closed,
      resultsVisible,
    });
  }
  return out;
}

interface ReplyRow {
  id: string;
  parent_id: string | null;
  body: string;
  deleted: boolean;
  hidden: boolean;
  created_at: Date;
  mine: boolean;
  pseudonym: string;
  former: boolean;
  upvotes: number;
  upvoted: boolean;
}

const REPLY_COLUMNS = `r.id, r.parent_id, r.body, (r.deleted_at IS NOT NULL) AS deleted, r.hidden, r.created_at,
  coalesce(r.user_id = $1::uuid, false) AS mine, u.pseudonym, (u.deleted_at IS NOT NULL) AS former,
  (SELECT count(*) FROM upvotes v WHERE v.target_type = 'reply' AND v.target_id = r.id) AS upvotes,
  EXISTS (SELECT 1 FROM upvotes v WHERE v.target_type = 'reply' AND v.target_id = r.id AND v.user_id = $1::uuid) AS upvoted`;

function toReply(r: ReplyRow, isAdmin: boolean): Reply {
  return {
    id: r.id,
    parentId: r.parent_id,
    body: r.deleted ? '' : r.body,
    deleted: r.deleted,
    author: r.deleted ? null : authorOf(r.pseudonym, r.former),
    createdAt: r.created_at.toISOString(),
    upvotes: r.upvotes,
    upvoted: r.upvoted,
    mine: r.deleted ? false : r.mine,
    ...(isAdmin && r.hidden ? { hidden: true } : {}),
  };
}

// ---------- helpers ----------

function viewer(res: Response): { user: SessionUser | null; isAdmin: boolean } {
  const user = res.locals.session?.user ?? null;
  return { user, isAdmin: user?.role === 'admin' };
}

/** Topics are bigger than a reply, so they use the listing numbers: 5 a day for new accounts, 20 after. Run inside the insert transaction. */
async function checkTopicCap(db: Queryable, user: SessionUser): Promise<void> {
  if (user.role === 'admin') return;
  await lockCaps(db, user.id);
  const cap = isFreshAccount(user) ? CAPS.listing.fresh : CAPS.listing.established;
  const { n } = await db.one<{ n: number }>(
    `SELECT count(*) AS n FROM topics WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
    [user.id],
  );
  if (n >= cap) fail(429, `You have reached today's limit of ${cap}. Please try again tomorrow.`, 'daily_cap');
}

/** 404 unless the reply target exists and the viewer may see it. */
async function assertTarget(db: Queryable, type: 'listing' | 'topic', targetId: string, isAdmin: boolean): Promise<void> {
  const table = type === 'listing' ? 'listings' : 'topics';
  const row = await db.maybeOne<{ hidden: boolean }>(`SELECT hidden FROM ${table} WHERE id = $1`, [targetId]);
  if (!row || (row.hidden && !isAdmin)) fail(404, 'That item was not found.', 'not_found');
}

async function toggleUpvote(db: Queryable, type: 'topic' | 'reply', targetId: string, userId: string): Promise<UpvoteResponse> {
  const removed = await db.query(
    'DELETE FROM upvotes WHERE target_type = $1 AND target_id = $2 AND user_id = $3 RETURNING 1',
    [type, targetId, userId],
  );
  if (!removed.length) {
    await db.query(
      'INSERT INTO upvotes (target_type, target_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [type, targetId, userId],
    );
  }
  const { n } = await db.one<{ n: number }>('SELECT count(*) AS n FROM upvotes WHERE target_type = $1 AND target_id = $2', [type, targetId]);
  return { upvoted: removed.length === 0, upvotes: n };
}

// ---------- router ----------

export function router(deps: Deps): Router {
  const r = Router();
  const { db } = deps;

  async function loadTopic(topicId: string, user: SessionUser | null, isAdmin: boolean): Promise<TopicDetail> {
    const row = await db.maybeOne<TopicRow>(
      `SELECT ${topicColumns('$2::uuid')} FROM topics t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
      [topicId, user?.id ?? null],
    );
    if (!row || (row.hidden && !isAdmin)) fail(404, 'That discussion was not found.', 'not_found');
    const polls = await loadPolls(db, [row], user?.id ?? null);
    let listings: LinkedListing[] = [];
    if (row.listing_ids.length) {
      const found = await db.query<LinkedListing & { hidden: boolean }>(
        'SELECT id, name, slug, kind, hidden FROM listings WHERE id = ANY($1::uuid[])',
        [row.listing_ids],
      );
      const byId = new Map(found.filter((l) => isAdmin || !l.hidden).map((l) => [l.id, { id: l.id, name: l.name, slug: l.slug, kind: l.kind }]));
      listings = row.listing_ids.map((lid) => byId.get(lid)).filter((l): l is LinkedListing => Boolean(l));
    }
    return { ...toSummary(row, polls.get(row.id) ?? null, isAdmin), body: row.body, listings };
  }

  r.get('/talk/topics', async (req, res) => {
    const q = parse(listQuery, req.query);
    const cursor = decodeCursor(q.cursor, q.sort);
    const { user, isAdmin } = viewer(res);
    const params: Param[] = [user?.id ?? null];
    const add = (v: Param) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = ['NOT t.hidden'];
    if (q.tag) where.push(`${add(q.tag)} = ANY(t.tags)`);
    let sql: string;
    let nowIso: string | null = null;
    if (q.sort === 'new') {
      if (cursor?.k === 'new') {
        where.push(`(t.pinned, t.created_at, t.id) < (SELECT c.pinned, c.created_at, c.id FROM topics c WHERE c.id = ${add(cursor.id)}::uuid)`);
      }
      sql = `SELECT ${topicColumns('$1::uuid')} FROM topics t JOIN users u ON u.id = t.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY t.pinned DESC, t.created_at DESC, t.id DESC
        LIMIT ${add(q.limit + 1)}`;
    } else {
      // The clock is frozen in the cursor so every page ranks against the same moment.
      nowIso = cursor?.k === 'hot' ? cursor.t : new Date().toISOString();
      const offset = cursor?.k === 'hot' ? cursor.o : 0;
      const now = add(nowIso);
      sql = `SELECT * FROM (
          SELECT ${topicColumns('$1::uuid')} FROM topics t JOIN users u ON u.id = t.user_id
          WHERE ${where.join(' AND ')}
        ) x
        ORDER BY x.pinned DESC,
          (x.upvotes + x.reply_count * 0.5 + 1)
            / power(greatest(extract(epoch FROM (${now}::timestamptz - x.created_at)) / 3600, 0) + 2, 1.5) DESC,
          x.created_at DESC, x.id DESC
        LIMIT ${add(q.limit + 1)} OFFSET ${add(offset)}`;
    }
    const rows = await db.query<TopicRow>(sql, params);
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const polls = await loadPolls(db, page, user?.id ?? null);
    let nextCursor: string | null = null;
    if (more && page.length) {
      nextCursor = q.sort === 'new'
        ? encodeCursor({ k: 'new', id: page[page.length - 1].id })
        : encodeCursor({ k: 'hot', o: (cursor?.k === 'hot' ? cursor.o : 0) + page.length, t: nowIso! });
    }
    const response: TopicListResponse = { items: page.map((row) => toSummary(row, polls.get(row.id) ?? null, isAdmin)), nextCursor };
    res.json(response);
  });

  r.get('/talk/tags', async (_req, res) => {
    const rows = await db.query<{ tag: string }>(
      `SELECT tag, count(*) AS n FROM topics t, unnest(t.tags) AS tag
       WHERE NOT t.hidden GROUP BY tag ORDER BY count(*) DESC, tag LIMIT 12`,
    );
    const response: TagsResponse = { tags: rows.map((row) => row.tag) };
    res.json(response);
  });

  r.get('/talk/topics/:id', async (req, res) => {
    const topicId = routeId(req.params.id);
    const { user, isAdmin } = viewer(res);
    const response: TopicResponse = { topic: await loadTopic(topicId, user, isAdmin) };
    res.json(response);
  });

  r.post('/talk/topics', requireUser, async (req, res) => {
    const user = currentUser(res);
    const input = parse(createTopic, req.body);
    rejectContact(input.title, input.body, ...input.tags, ...(input.kind === 'poll' ? input.options : []));
    let closesAt: Date | null = null;
    if (input.kind === 'poll') {
      if (input.closesAt) {
        closesAt = new Date(input.closesAt);
        const ahead = closesAt.getTime() - Date.now();
        if (ahead < 60 * 60 * 1000) fail(400, 'A poll must stay open for at least an hour.', 'invalid_input', 'closesAt');
        if (ahead > POLL_DAYS_MAX * DAY_MS + 60_000) fail(400, `A poll runs for at most ${POLL_DAYS_MAX} days.`, 'invalid_input', 'closesAt');
      } else {
        closesAt = new Date(Date.now() + (input.durationDays ?? POLL_DAYS_DEFAULT) * DAY_MS);
      }
    }
    if (input.listingIds.length) {
      const found = await db.query<{ id: string }>(
        'SELECT id FROM listings WHERE id = ANY($1::uuid[]) AND NOT hidden',
        [input.listingIds],
      );
      if (found.length !== input.listingIds.length) {
        fail(400, 'One of the linked places is not available. Remove it and try again.', 'invalid_input', 'listingIds');
      }
    }
    const topicId = await db.tx(async (q) => {
      await checkTopicCap(q, user);
      const row = await q.one<{ id: string }>(
        `INSERT INTO topics (user_id, kind, title, body, tags, listing_ids, closes_at)
         VALUES ($1, $2, $3, $4, $5::text[], $6::uuid[], $7) RETURNING id`,
        [user.id, input.kind, input.title, input.body, input.tags, input.listingIds, closesAt],
      );
      if (input.kind === 'poll') {
        for (const [i, label] of input.options.entries()) {
          await q.query('INSERT INTO poll_options (topic_id, label, position) VALUES ($1, $2, $3)', [row.id, label, i]);
        }
      }
      return row.id;
    });
    const response: TopicResponse = { topic: await loadTopic(topicId, user, user.role === 'admin') };
    res.status(201).json(response);
  });

  r.post('/talk/topics/:id/vote', requireUser, async (req, res) => {
    const user = currentUser(res);
    const topicId = routeId(req.params.id);
    const { optionId } = parse(voteBody, req.body);
    const topic = await db.maybeOne<{ id: string; kind: 'discussion' | 'poll'; closes_at: Date | null; closed: boolean; hidden: boolean }>(
      `SELECT id, kind, closes_at, hidden, (closes_at IS NOT NULL AND closes_at <= now()) AS closed FROM topics WHERE id = $1`,
      [topicId],
    );
    if (!topic || (topic.hidden && user.role !== 'admin')) fail(404, 'That poll was not found.', 'not_found');
    if (topic.kind !== 'poll') fail(400, 'This discussion is not a poll.', 'not_a_poll');
    if (topic.closed) fail(409, 'This poll has closed.', 'poll_closed');
    const opt = await db.maybeOne('SELECT 1 FROM poll_options WHERE id = $1 AND topic_id = $2', [optionId.toLowerCase(), topicId]);
    if (!opt) fail(400, 'That option is not part of this poll.', 'invalid_input', 'optionId');
    await db.query(
      `INSERT INTO poll_votes (topic_id, user_id, option_id) VALUES ($1, $2, $3)
       ON CONFLICT (topic_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, created_at = now()`,
      [topicId, user.id, optionId.toLowerCase()],
    );
    const polls = await loadPolls(db, [topic], user.id);
    const response: VoteResponse = { poll: polls.get(topicId)! };
    res.json(response);
  });

  // Withdraw a vote before close. The page uses it to undo a first vote.
  r.delete('/talk/topics/:id/vote', requireUser, async (req, res) => {
    const user = currentUser(res);
    const topicId = routeId(req.params.id);
    const topic = await db.maybeOne<{ id: string; kind: 'discussion' | 'poll'; closes_at: Date | null; closed: boolean; hidden: boolean }>(
      `SELECT id, kind, closes_at, hidden, (closes_at IS NOT NULL AND closes_at <= now()) AS closed FROM topics WHERE id = $1`,
      [topicId],
    );
    if (!topic || (topic.hidden && user.role !== 'admin')) fail(404, 'That poll was not found.', 'not_found');
    if (topic.kind !== 'poll') fail(400, 'This discussion is not a poll.', 'not_a_poll');
    if (topic.closed) fail(409, 'This poll has closed.', 'poll_closed');
    await db.query('DELETE FROM poll_votes WHERE topic_id = $1 AND user_id = $2', [topicId, user.id]);
    const polls = await loadPolls(db, [topic], user.id);
    const response: VoteResponse = { poll: polls.get(topicId)! };
    res.json(response);
  });

  r.post('/talk/topics/:id/upvote', requireUser, async (req, res) => {
    const user = currentUser(res);
    const topicId = routeId(req.params.id);
    await assertTarget(db, 'topic', topicId, user.role === 'admin');
    const response: UpvoteResponse = await toggleUpvote(db, 'topic', topicId, user.id);
    res.json(response);
  });

  r.post('/talk/topics/:id/pin', requireAdmin, async (req, res) => {
    const user = currentUser(res);
    const topicId = routeId(req.params.id);
    const input = parse(pinBody, req.body ?? {});
    const out = await db.tx(async (q) => {
      const row = await q.maybeOne<{ pinned: boolean }>(
        `UPDATE topics SET pinned = coalesce($2::boolean, NOT pinned) WHERE id = $1 RETURNING pinned`,
        [topicId, input.pinned ?? null],
      );
      if (!row) fail(404, 'That discussion was not found.', 'not_found');
      await audit(q, { actorId: user.id, action: row.pinned ? 'topic.pin' : 'topic.unpin', targetType: 'topic', targetId: topicId });
      return row;
    });
    const response: PinResponse = { pinned: out.pinned };
    res.json(response);
  });

  r.get('/talk/linked', async (req, res) => {
    const { listing_id: listingId } = parse(z.object({ listing_id: id }), req.query);
    const { user, isAdmin } = viewer(res);
    const rows = await db.query<TopicRow>(
      `SELECT ${topicColumns('$2::uuid')} FROM topics t JOIN users u ON u.id = t.user_id
       WHERE $1::uuid = ANY(t.listing_ids) AND NOT t.hidden
       ORDER BY t.pinned DESC, t.created_at DESC, t.id DESC LIMIT 3`,
      [listingId.toLowerCase(), user?.id ?? null],
    );
    const { n } = await db.one<{ n: number }>(
      'SELECT count(*) AS n FROM topics t WHERE $1::uuid = ANY(t.listing_ids) AND NOT t.hidden',
      [listingId.toLowerCase()],
    );
    const polls = await loadPolls(db, rows, user?.id ?? null);
    const response: LinkedTopicsResponse = { items: rows.map((row) => toSummary(row, polls.get(row.id) ?? null, isAdmin)), total: n };
    res.json(response);
  });

  r.get('/talk/replies', async (req, res) => {
    const q = parse(repliesQuery, req.query);
    const targetId = q.target_id.toLowerCase();
    const { user, isAdmin } = viewer(res);
    await assertTarget(db, q.target_type, targetId, isAdmin);
    if (q.cursor) {
      const anchor = await db.maybeOne(
        `SELECT id FROM replies WHERE id = $1 AND target_type = $2 AND target_id = $3 AND parent_id IS NULL ${isAdmin ? '' : 'AND NOT hidden'}`,
        [q.cursor, q.target_type, targetId],
      );
      if (!anchor) fail(400, 'That page link is not valid. Please refresh.', 'bad_cursor');
    }
    const visible = `WITH visible AS (
      SELECT * FROM replies WHERE target_type = $2 AND target_id = $3 ${isAdmin ? '' : 'AND NOT hidden'}
    )`;
    const rows = await db.query<ReplyRow>(
      `${visible}
       SELECT ${REPLY_COLUMNS} FROM visible r JOIN users u ON u.id = r.user_id
       WHERE r.parent_id IS NULL AND (r.deleted_at IS NULL OR EXISTS (
         SELECT 1 FROM visible c WHERE c.parent_id = r.id AND c.deleted_at IS NULL
       )) AND ($4::uuid IS NULL OR (r.created_at, r.id) > (
         SELECT created_at, id FROM replies WHERE id = $4
       ))
       ORDER BY r.created_at, r.id LIMIT $5`,
      [user?.id ?? null, q.target_type, targetId, q.cursor ?? null, q.limit + 1],
    );
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const children = page.length ? await db.query<ReplyRow>(
      `SELECT ${REPLY_COLUMNS} FROM replies r JOIN users u ON u.id = r.user_id
       WHERE r.target_type = $2 AND r.target_id = $3 AND r.parent_id = ANY($4::uuid[])
       AND r.deleted_at IS NULL ${isAdmin ? '' : 'AND NOT r.hidden'} ORDER BY r.created_at, r.id`,
      [user?.id ?? null, q.target_type, targetId, page.map((r) => r.id)],
    ) : [];
    const threads = new Map<string, ReplyThread>();
    for (const row of page) threads.set(row.id, { ...toReply(row, isAdmin), replies: [] });
    // A child whose parent is hidden stays hidden with it.
    for (const row of children) if (row.parent_id) threads.get(row.parent_id)?.replies.push(toReply(row, isAdmin));
    const items = [...threads.values()];
    const { total } = await db.one<{ total: number }>(
      `WITH visible AS (
         SELECT * FROM replies WHERE target_type = $1 AND target_id = $2 ${isAdmin ? '' : 'AND NOT hidden'}
       ) SELECT count(*) AS total FROM visible r LEFT JOIN visible p ON p.id = r.parent_id
       WHERE r.deleted_at IS NULL AND (r.parent_id IS NULL OR p.parent_id IS NULL AND p.id IS NOT NULL)`,
      [q.target_type, targetId],
    );
    const response: RepliesResponse = { items, total, nextCursor: hasMore ? page[page.length - 1].id : null };
    res.json(response);
  });

  r.post('/talk/replies', requireUser, async (req, res) => {
    const user = currentUser(res);
    const input = parse(replyBody, req.body);
    const isAdmin = user.role === 'admin';
    const targetId = input.targetId.toLowerCase();
    await assertTarget(db, input.targetType, targetId, isAdmin);
    rejectContact(input.body);
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await db.maybeOne<{ id: string; parent_id: string | null; target_type: string; target_id: string; hidden: boolean }>(
        'SELECT id, parent_id, target_type, target_id, hidden FROM replies WHERE id = $1',
        [input.parentId.toLowerCase()],
      );
      if (!parent || parent.target_type !== input.targetType || parent.target_id !== targetId || (parent.hidden && !isAdmin)) {
        fail(404, 'The reply you answered was not found.', 'not_found', 'parentId');
      }
      // One level deep: a reply to a reply joins its top level parent.
      parentId = parent.parent_id ?? parent.id;
    }
    const replyId = await db.tx(async (q) => {
      await checkCap(q, user, 'post');
      const row = await q.one<{ id: string }>(
        `INSERT INTO replies (target_type, target_id, parent_id, user_id, body) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [input.targetType, targetId, parentId, user.id, input.body],
      );
      return row.id;
    });
    const row = await db.one<ReplyRow>(
      `SELECT ${REPLY_COLUMNS} FROM replies r JOIN users u ON u.id = r.user_id WHERE r.id = $2`,
      [user.id, replyId],
    );
    const response: ReplyResponse = { reply: toReply(row, isAdmin) };
    res.status(201).json(response);
  });

  r.delete('/talk/replies/:id', requireUser, async (req, res) => {
    const user = currentUser(res);
    const replyId = routeId(req.params.id);
    const row = await db.maybeOne<{ user_id: string; hidden: boolean }>('SELECT user_id, hidden FROM replies WHERE id = $1', [replyId]);
    if (!row || (row.hidden && user.role !== 'admin')) fail(404, 'That reply was not found.', 'not_found');
    if (row.user_id !== user.id) fail(403, 'You can only delete your own replies.', 'not_yours');
    // The text goes; the row stays so answers under it keep their place. It shows as "Deleted".
    await db.query(`UPDATE replies SET deleted_at = coalesce(deleted_at, now()), body = '' WHERE id = $1`, [replyId]);
    res.json({ ok: true });
  });

  r.post('/talk/replies/:id/upvote', requireUser, async (req, res) => {
    const user = currentUser(res);
    const replyId = routeId(req.params.id);
    const isAdmin = user.role === 'admin';
    const row = await db.maybeOne<{ hidden: boolean; deleted: boolean; target_type: 'listing' | 'topic'; target_id: string }>(
      'SELECT hidden, (deleted_at IS NOT NULL) AS deleted, target_type, target_id FROM replies WHERE id = $1',
      [replyId],
    );
    if (!row || row.deleted || (row.hidden && !isAdmin)) fail(404, 'That reply was not found.', 'not_found');
    await assertTarget(db, row.target_type, row.target_id, isAdmin);
    const response: UpvoteResponse = await toggleUpvote(db, 'reply', replyId, user.id);
    res.json(response);
  });

  return r;
}
