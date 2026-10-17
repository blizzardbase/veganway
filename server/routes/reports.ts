// Reports. Mounted at /api/reports (server/app.ts).
//   POST /api/reports   any member reports a listing, recommendation, topic, reply, photo or user
//   GET  /api/reports   admins see every report
// Three open reports from distinct members whose accounts are older than 72 hours hide the target
// until an admin decides, except a recommendation or reply on a listing that one of the reporters
// owns: an owner cannot bury reviews with burner accounts, so those wait for an admin.
// Only an admin hide deletes photo bytes. The admin queue and actions live in routes/admin.ts.
import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { Queryable } from '../db.js';
import { audit } from '../lib/audit.js';
import { currentUser, requireAdmin, requireUser } from '../lib/auth.js';
import { fail, parse } from '../lib/http.js';
import { limit, type Rule } from '../lib/rate.js';
import {
  AUTO_HIDE_REPORTS, REPORT_ACCOUNT_AGE_HOURS, REPORT_NOTE_MAX, REPORT_REASONS, REPORT_TARGETS,
  type ReportCreated, type ReportTarget, type TargetPreview,
} from '../../shared/types/admin.js';

const REPORT_RULE: Rule = { max: 30, windowSec: 60 * 60 };

const reportBody = z.object({
  targetType: z.enum(REPORT_TARGETS, { error: 'That cannot be reported.' }),
  targetId: z.uuid({ error: 'That item was not found.' }),
  reason: z.enum(REPORT_REASONS, { error: 'Pick a reason.' }),
  note: z.string({ error: 'The note is not valid.' }).trim().max(REPORT_NOTE_MAX, { error: `Use at most ${REPORT_NOTE_MAX} characters.` }).optional(),
});

/** Accepts camelCase or the snake_case keys other slices may send. */
function normalizeKeys(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, unknown>;
  return { targetType: b.targetType ?? b.target_type, targetId: b.targetId ?? b.target_id, reason: b.reason, note: b.note ?? undefined };
}

const TABLE: Record<Exclude<ReportTarget, 'photo' | 'user'>, string> = {
  listing: 'listings',
  recommendation: 'recommendations',
  topic: 'topics',
  reply: 'replies',
};

/** True when the target exists (hidden or not). The system account cannot be reported. */
export async function targetExists(db: Queryable, type: ReportTarget, id: string): Promise<boolean> {
  if (type === 'photo') return Boolean(await db.maybeOne('SELECT 1 FROM photos WHERE id = $1', [id]));
  if (type === 'user') return Boolean(await db.maybeOne('SELECT 1 FROM users WHERE id = $1 AND NOT is_system', [id]));
  return Boolean(await db.maybeOne(`SELECT 1 FROM ${TABLE[type]} WHERE id = $1`, [id]));
}

/**
 * Hide or restore one target. Photos use deleted_at; a member's "hidden" state hides their optional
 * public profile fields (display name, bio, photo). Returns false when nothing matched.
 */
export async function setHidden(db: Queryable, type: ReportTarget, id: string, hidden: boolean): Promise<boolean> {
  if (type === 'photo') {
    const rows = await db.query(
      `UPDATE photos SET hidden = $2, deleted_at = CASE WHEN $2 THEN coalesce(deleted_at, now()) ELSE deleted_at END WHERE id = $1 AND ($2 OR deleted_at IS NULL) RETURNING id`,
      [id, hidden],
    );
    return rows.length > 0;
  }
  if (type === 'user') {
    const rows = await db.query('UPDATE users SET profile_hidden = $2 WHERE id = $1 AND NOT is_system RETURNING id', [id, hidden]);
    return rows.length > 0;
  }
  const rows = await db.query(`UPDATE ${TABLE[type]} SET hidden = $2 WHERE id = $1 RETURNING id`, [id, hidden]);
  return rows.length > 0;
}

/** The stored bytes of a photo, for deleting after the hide commits. */
export async function photoBlobPath(db: Queryable, id: string): Promise<string | null> {
  const row = await db.maybeOne<{ blob_path: string }>('SELECT blob_path FROM photos WHERE id = $1', [id]);
  return row?.blob_path ?? null;
}

/**
 * True when the latest hide or restore of this target was the automatic hide by reports, so an
 * admin who dismisses the reports should also show it again.
 */
export async function lastHideWasAuto(db: Queryable, type: ReportTarget, id: string): Promise<boolean> {
  const row = await db.maybeOne<{ action: string }>(
    `SELECT action FROM audit WHERE target_type = $1 AND target_id = $2
       AND action IN ('report.auto_hide', 'moderation.hide', 'moderation.restore')
     ORDER BY created_at DESC LIMIT 1`,
    [type, id],
  );
  return row?.action === 'report.auto_hide';
}

/** The owner of the listing a recommendation or listing reply sits on, or null. */
async function listingOwnerOf(db: Queryable, type: ReportTarget, id: string): Promise<string | null> {
  if (type === 'recommendation') {
    const row = await db.maybeOne<{ owner_user_id: string | null }>(
      'SELECT l.owner_user_id FROM recommendations r JOIN listings l ON l.id = r.listing_id WHERE r.id = $1', [id]);
    return row?.owner_user_id ?? null;
  }
  if (type === 'photo') {
    // A shared photo can sit on several reviews; any reporting listing owner exempts it.
    const row = await db.maybeOne<{ owner_user_id: string }>(
      `SELECT l.owner_user_id FROM recommendations r JOIN listings l ON l.id = r.listing_id
       JOIN reports p ON p.target_type = 'photo' AND p.target_id = r.photo_id
         AND p.user_id = l.owner_user_id AND p.resolved_at IS NULL
       WHERE r.photo_id = $1 LIMIT 1`, [id]);
    return row?.owner_user_id ?? null;
  }
  if (type === 'reply') {
    const row = await db.maybeOne<{ owner_user_id: string | null }>(
      `SELECT l.owner_user_id FROM replies x JOIN listings l ON x.target_type = 'listing' AND l.id = x.target_id WHERE x.id = $1`, [id]);
    return row?.owner_user_id ?? null;
  }
  return null;
}

export async function isHidden(db: Queryable, type: ReportTarget, id: string): Promise<boolean> {
  if (type === 'photo') return Boolean(await db.maybeOne('SELECT 1 FROM photos WHERE id = $1 AND (hidden OR deleted_at IS NOT NULL)', [id]));
  if (type === 'user') return Boolean(await db.maybeOne('SELECT 1 FROM users WHERE id = $1 AND profile_hidden', [id]));
  return Boolean(await db.maybeOne(`SELECT 1 FROM ${TABLE[type]} WHERE id = $1 AND hidden`, [id]));
}

const excerpt = (text: string | null | undefined, max = 160) => {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const listingPath = (kind: string, slug: string) => `/${kind === 'service' ? 'services' : kind === 'product' ? 'products' : 'places'}/${slug}`;

/** A short look at a target for the admin queue. */
export async function previewTarget(db: Queryable, type: ReportTarget, id: string): Promise<TargetPreview> {
  const missing: TargetPreview = { title: 'Removed item', excerpt: null, path: null, hidden: false, author: null, authorId: null, exists: false };
  switch (type) {
    case 'listing': {
      const r = await db.maybeOne<{ name: string; kind: string; slug: string; summary: string; hidden: boolean; author: string; author_id: string }>(
        `SELECT l.name, l.kind, l.slug, l.summary, l.hidden, u.pseudonym AS author, u.id AS author_id
         FROM listings l JOIN users u ON u.id = l.created_by WHERE l.id = $1`, [id]);
      return r ? { title: r.name, excerpt: excerpt(r.summary), path: listingPath(r.kind, r.slug), hidden: r.hidden, author: r.author, authorId: r.author_id, exists: true } : missing;
    }
    case 'recommendation': {
      const r = await db.maybeOne<{ body: string; hidden: boolean; name: string; kind: string; slug: string; author: string; author_id: string }>(
        `SELECT x.body, x.hidden, l.name, l.kind, l.slug, u.pseudonym AS author, u.id AS author_id
         FROM recommendations x JOIN listings l ON l.id = x.listing_id JOIN users u ON u.id = x.user_id WHERE x.id = $1`, [id]);
      return r ? { title: `Recommendation on ${r.name}`, excerpt: excerpt(r.body), path: listingPath(r.kind, r.slug), hidden: r.hidden, author: r.author, authorId: r.author_id, exists: true } : missing;
    }
    case 'topic': {
      const r = await db.maybeOne<{ title: string; body: string | null; hidden: boolean; author: string; author_id: string }>(
        `SELECT t.title, t.body, t.hidden, u.pseudonym AS author, u.id AS author_id FROM topics t JOIN users u ON u.id = t.user_id WHERE t.id = $1`, [id]);
      return r ? { title: r.title, excerpt: excerpt(r.body), path: `/talk/${id}`, hidden: r.hidden, author: r.author, authorId: r.author_id, exists: true } : missing;
    }
    case 'reply': {
      const r = await db.maybeOne<{ body: string; hidden: boolean; target_type: string; target_id: string; author: string; author_id: string }>(
        `SELECT x.body, x.hidden, x.target_type, x.target_id, u.pseudonym AS author, u.id AS author_id
         FROM replies x JOIN users u ON u.id = x.user_id WHERE x.id = $1`, [id]);
      if (!r) return missing;
      // The title names what the reply is on, so the card says the item, not the type twice.
      let path: string | null = null;
      let on: string | null = null;
      if (r.target_type === 'topic') {
        const t = await db.maybeOne<{ title: string }>('SELECT title FROM topics WHERE id = $1', [r.target_id]);
        path = `/talk/${r.target_id}`;
        on = t?.title ?? null;
      } else {
        const l = await db.maybeOne<{ kind: string; slug: string; name: string }>('SELECT kind, slug, name FROM listings WHERE id = $1', [r.target_id]);
        if (l) {
          path = listingPath(l.kind, l.slug);
          on = l.name;
        }
      }
      return { title: on ? `Reply on ${on}` : 'Reply', excerpt: excerpt(r.body), path, hidden: r.hidden, author: r.author, authorId: r.author_id, exists: true };
    }
    case 'photo': {
      const r = await db.maybeOne<{ blob_path: string; hidden: boolean; deleted_at: Date | null; author: string; author_id: string }>(
        `SELECT p.blob_path, p.hidden, p.deleted_at, u.pseudonym AS author, u.id AS author_id FROM photos p JOIN users u ON u.id = p.user_id WHERE p.id = $1`, [id]);
      return r ? { title: 'Photo', excerpt: null, path: r.hidden || r.deleted_at ? null : `/media/${r.blob_path}`, hidden: r.hidden || r.deleted_at !== null, author: r.author, authorId: r.author_id, exists: true } : missing;
    }
    case 'user': {
      const r = await db.maybeOne<{ pseudonym: string; display_name: string | null; bio: string | null; profile_hidden: boolean; banned_at: Date | null }>(
        'SELECT pseudonym, display_name, bio, profile_hidden, banned_at FROM users WHERE id = $1', [id]);
      return r
        ? { title: r.banned_at ? `${r.pseudonym} (banned)` : r.pseudonym, excerpt: excerpt([r.display_name, r.bio].filter(Boolean).join(': ')), path: null, hidden: r.profile_hidden, author: r.pseudonym, authorId: id, exists: true }
        : missing;
    }
  }
}

export function router(deps: Deps): Router {
  const r = Router();
  const { db } = deps;

  // Existing listing and recommendation projections expose a URL. Resolve only a currently
  // displayed photo, without changing those projections or revealing unattached uploads.
  r.get('/photo-target', requireUser, async (req, res) => {
    const { url } = parse(z.object({ url: z.string().max(500).regex(/^\/media\/photos\/[a-zA-Z0-9._-]+$/) }), req.query);
    const photo = await db.maybeOne<{ id: string }>(
      `SELECT p.id FROM photos p WHERE p.blob_path = $1 AND p.deleted_at IS NULL AND NOT p.hidden AND (
        EXISTS (SELECT 1 FROM listings l WHERE l.photo_id = p.id AND NOT l.hidden)
        OR EXISTS (SELECT 1 FROM recommendations r JOIN listings l ON l.id = r.listing_id
          WHERE r.photo_id = p.id AND NOT r.hidden AND NOT l.hidden)
      )`, [url.slice('/media/'.length)],
    );
    if (!photo) fail(404, 'That photo was not found.', 'not_found');
    res.json(photo);
  });

  r.post('/', requireUser, async (req, res) => {
    const me = currentUser(res);
    const body = parse(reportBody, normalizeKeys(req.body));
    await limit(db, `report:${me.id}`, REPORT_RULE);
    if (!(await targetExists(db, body.targetType, body.targetId))) fail(404, 'That item was not found.', 'not_found');
    if (body.targetType === 'user' && body.targetId === me.id) fail(400, 'You cannot report yourself.', 'invalid_input');

    const out = await db.tx(async (q) => {
      // Reports on one target run one at a time, so two concurrent third reports cannot both hide it.
      await q.query(`SELECT pg_advisory_xact_lock(hashtext('report_target:' || $1 || $2))`, [body.targetType, body.targetId]);
      // One open report per member per target. A resolved one may be reopened with a new reason.
      const row = await q.maybeOne<{ id: string }>(
        `INSERT INTO reports (target_type, target_id, user_id, reason, note) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (target_type, target_id, user_id) DO UPDATE
           SET reason = EXCLUDED.reason, note = EXCLUDED.note, created_at = now(), resolved_at = NULL
           WHERE reports.resolved_at IS NOT NULL
         RETURNING id`,
        [body.targetType, body.targetId, me.id, body.reason, body.note || null],
      );
      if (!row) fail(409, 'You already reported this. An admin will look at it.', 'already_reported');

      const { n } = await q.one<{ n: number }>(
        `SELECT count(DISTINCT r.user_id) AS n FROM reports r JOIN users u ON u.id = r.user_id
         WHERE r.target_type = $1 AND r.target_id = $2 AND r.resolved_at IS NULL
           AND u.created_at < now() - make_interval(hours => $3) AND u.banned_at IS NULL AND u.deleted_at IS NULL`,
        [body.targetType, body.targetId, REPORT_ACCOUNT_AGE_HOURS],
      );
      let hidden = false;
      if (n >= AUTO_HIDE_REPORTS && !(await isHidden(q, body.targetType, body.targetId))) {
        const owner = await listingOwnerOf(q, body.targetType, body.targetId);
        const ownerReported = owner !== null && Boolean(await q.maybeOne(
          'SELECT 1 FROM reports WHERE target_type = $1 AND target_id = $2 AND resolved_at IS NULL AND user_id = $3',
          [body.targetType, body.targetId, owner],
        ));
        if (!ownerReported) {
          hidden = body.targetType === 'photo'
            ? (await q.query('UPDATE photos SET hidden = true WHERE id = $1 RETURNING id', [body.targetId])).length > 0
            : await setHidden(q, body.targetType, body.targetId, true);
          if (hidden) {
            await audit(q, { actorId: null, action: 'report.auto_hide', targetType: body.targetType, targetId: body.targetId, detail: { reporters: n } });
          }
        }
      }
      return { hidden };
    });
    const response: ReportCreated = { ok: true, hidden: out.hidden };
    res.status(201).json(response);
  });

  // Admins see every report, newest first.
  r.get('/', requireAdmin, async (req, res) => {
    const open = req.query.status === 'open';
    const rows = await db.query<{ id: string; target_type: string; target_id: string; reason: string; note: string | null; created_at: Date; resolved_at: Date | null; reporter: string }>(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.created_at, r.resolved_at, u.pseudonym AS reporter
       FROM reports r JOIN users u ON u.id = r.user_id
       ${open ? 'WHERE r.resolved_at IS NULL' : ''}
       ORDER BY r.created_at DESC LIMIT 200`,
    );
    res.json({
      reports: rows.map((x) => ({
        id: x.id,
        targetType: x.target_type,
        targetId: x.target_id,
        reason: x.reason,
        note: x.note,
        reporter: x.reporter,
        createdAt: x.created_at.toISOString(),
        resolvedAt: x.resolved_at ? x.resolved_at.toISOString() : null,
      })),
    });
  });

  return r;
}
