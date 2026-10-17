// Admin. Every path here needs the admin role (requireAdmin runs first on /admin and everything under it).
// Mounted at /api. This router owns:
//   GET  /admin/reports                    open reports grouped by target, with a preview; auto hidden first
//   POST /admin/moderate                   hide, restore or dismiss one target (dismiss shows an auto hidden one again)
//   GET  /admin/hidden                     everything hidden now, and banned members, for Restore and Unban
//   POST /admin/users/:id/ban | /unban     ban: banned_at, sessions deleted, content hidden, photos deleted,
//                                          opinions and upvotes removed
//   GET  /admin/claims                     claims queue (?status=pending|all)
//   POST /admin/claims/:id/approve | /reject | /revoke
//   POST /admin/listings/:id/revoke-owner
//   GET  /admin/listings?q=                find listings, hidden included, for merging
//   POST /admin/listings/merge             { survivorId, loserId }
//   GET  /admin/audit?before=              audit log, newest first
// Every action writes an audit row in the same transaction.
import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { Queryable } from '../db.js';
import { audit } from '../lib/audit.js';
import { currentUser, requireAdmin } from '../lib/auth.js';
import { fail, parse } from '../lib/http.js';
import { deleteMedia } from '../lib/media.js';
import { isHidden, lastHideWasAuto, photoBlobPath, previewTarget, setHidden } from './reports.js';
import {
  REPORT_TARGETS,
  type AdminClaim, type AdminListings, type AuditPage, type ClaimQueue, type HiddenItem, type HiddenList, type MergeResult, type ReportGroup, type ReportQueue,
  type ReportReason, type ReportTarget,
} from '../../shared/types/admin.js';

const uuid = z.uuid({ error: 'That item was not found.' });
const moderateBody = z.object({
  targetType: z.enum(REPORT_TARGETS, { error: 'Unknown target.' }),
  targetId: uuid,
  action: z.enum(['hide', 'restore', 'dismiss'], { error: 'Unknown action.' }),
});
const mergeBody = z.object({ survivorId: uuid, loserId: uuid });

async function resolveReports(q: Queryable, type: ReportTarget, id: string): Promise<number> {
  const rows = await q.query('UPDATE reports SET resolved_at = now() WHERE target_type = $1 AND target_id = $2 AND resolved_at IS NULL RETURNING id', [type, id]);
  return rows.length;
}

/** After an owner leaves, keep has_service true only while they still run a service. */
async function refreshHasService(q: Queryable, userId: string): Promise<void> {
  await q.query(
    `UPDATE users SET has_service = EXISTS (SELECT 1 FROM listings WHERE owner_user_id = $1 AND kind = 'service') WHERE id = $1`,
    [userId],
  );
}

/** Remove the owner of a listing: approved claims become revoked and the owner's contact details go with them. */
async function revokeOwner(q: Queryable, actorId: string, listingId: string): Promise<boolean> {
  const row = await q.maybeOne<{ owner_user_id: string | null }>('SELECT owner_user_id FROM listings WHERE id = $1 FOR UPDATE', [listingId]);
  if (!row) fail(404, 'That listing was not found.', 'not_found');
  if (!row.owner_user_id) return false;
  await q.query('UPDATE listings SET owner_user_id = NULL, contact = NULL WHERE id = $1', [listingId]);
  await q.query(
    `UPDATE claims SET status = 'revoked', decided_by = $2, decided_at = now() WHERE listing_id = $1 AND status = 'approved'`,
    [listingId, actorId],
  );
  await refreshHasService(q, row.owner_user_id);
  await audit(q, { actorId, action: 'ownership.revoke', targetType: 'listing', targetId: listingId, detail: { formerOwnerId: row.owner_user_id } });
  return true;
}

export function router(deps: Deps): Router {
  const r = Router();
  const { db } = deps;

  r.use('/admin', requireAdmin);

  // ---------- reports ----------

  r.get('/admin/reports', async (_req, res) => {
    const groups = await db.query<{ target_type: ReportTarget; target_id: string; open_count: number; last_at: Date; reasons: { reason: ReportReason; count: number }[]; notes: string[] | null }>(
      `SELECT g.target_type, g.target_id, g.open_count, g.last_at, g.notes,
              (SELECT json_agg(json_build_object('reason', x.reason, 'count', x.n) ORDER BY x.n DESC)
               FROM (SELECT reason, count(*)::int AS n FROM reports
                     WHERE target_type = g.target_type AND target_id = g.target_id AND resolved_at IS NULL GROUP BY reason) x) AS reasons
       FROM (SELECT target_type, target_id, count(*) AS open_count, max(created_at) AS last_at,
                    (array_agg(note ORDER BY created_at DESC) FILTER (WHERE note IS NOT NULL))[1:3] AS notes
             FROM reports WHERE resolved_at IS NULL GROUP BY target_type, target_id) g
       ORDER BY g.open_count DESC, g.last_at DESC LIMIT 100`,
    );
    const out: ReportGroup[] = [];
    for (const g of groups) {
      const preview = await previewTarget(db, g.target_type, g.target_id);
      out.push({
        targetType: g.target_type,
        targetId: g.target_id,
        openCount: g.open_count,
        reasons: g.reasons ?? [],
        notes: g.notes ?? [],
        lastReportedAt: g.last_at.toISOString(),
        preview,
        autoHidden: preview.hidden && (await lastHideWasAuto(db, g.target_type, g.target_id)),
      });
    }
    // Items reports hid on their own need an admin first: they may be a real review someone buried.
    out.sort((a, b) => Number(b.autoHidden) - Number(a.autoHidden));
    const body: ReportQueue = { groups: out };
    res.json(body);
  });

  r.post('/admin/moderate', async (req, res) => {
    const me = currentUser(res);
    const body = parse(moderateBody, req.body);
    const result = await db.tx(async (q) => {
      let blobPath: string | null = null;
      let restored = false;
      if (body.targetType === 'photo' && body.action === 'restore' && (await isHidden(q, 'photo', body.targetId))) {
        fail(409, 'This photo was deleted when it was hidden, so it cannot come back.', 'photo_deleted');
      }
      if (body.action === 'hide' || body.action === 'restore') {
        const wasHidden = body.targetType === 'photo' && (await isHidden(q, 'photo', body.targetId));
        const changed = await setHidden(q, body.targetType, body.targetId, body.action === 'hide');
        if (!changed) fail(404, 'That item was not found.', 'not_found');
        if (body.targetType === 'photo' && body.action === 'hide' && !wasHidden) blobPath = await photoBlobPath(q, body.targetId);
      }
      // Dismiss means the reports were wrong, so an item they hid on their own comes back. A photo
      // cannot (its bytes are gone), and neither can the work of a member who has since been banned.
      if (body.action === 'dismiss' && body.targetType !== 'photo'
        && (await isHidden(q, body.targetType, body.targetId)) && (await lastHideWasAuto(q, body.targetType, body.targetId))) {
        const preview = await previewTarget(q, body.targetType, body.targetId);
        const banned = preview.authorId
          ? Boolean(await q.maybeOne('SELECT 1 FROM users WHERE id = $1 AND banned_at IS NOT NULL', [preview.authorId]))
          : false;
        if (!banned) restored = await setHidden(q, body.targetType, body.targetId, false);
      }
      const resolved = await resolveReports(q, body.targetType, body.targetId);
      await audit(q, {
        actorId: me.id, action: `moderation.${body.action}`, targetType: body.targetType, targetId: body.targetId,
        detail: body.action === 'dismiss' ? { resolvedReports: resolved, restored } : { resolvedReports: resolved },
      });
      return { resolved, restored, blobPath };
    });
    if (result.blobPath) await deleteMedia(deps.media, [result.blobPath]);
    res.json({ ok: true, resolvedReports: result.resolved, restored: result.restored });
  });

  r.get('/admin/hidden', async (_req, res) => {
    const rows = await db.query<{ target_type: HiddenItem['targetType']; id: string; created_at: Date }>(
      `SELECT * FROM (
         SELECT 'listing' AS target_type, id, created_at FROM listings WHERE hidden
         UNION ALL SELECT 'recommendation', id, created_at FROM recommendations WHERE hidden
         UNION ALL SELECT 'topic', id, created_at FROM topics WHERE hidden
         UNION ALL SELECT 'reply', id, created_at FROM replies WHERE hidden
         UNION ALL SELECT 'photo', id, created_at FROM photos WHERE deleted_at IS NOT NULL
         UNION ALL SELECT 'user', id, created_at FROM users WHERE profile_hidden AND deleted_at IS NULL
       ) x ORDER BY created_at DESC LIMIT 200`,
    );
    const items: HiddenItem[] = [];
    for (const x of rows) {
      items.push({
        targetType: x.target_type,
        targetId: x.id,
        createdAt: x.created_at.toISOString(),
        preview: await previewTarget(db, x.target_type, x.id),
        autoHidden: await lastHideWasAuto(db, x.target_type, x.id),
        restorable: x.target_type !== 'photo',
      });
    }
    const banned = await db.query<{ id: string; pseudonym: string; banned_at: Date }>(
      'SELECT id, pseudonym, banned_at FROM users WHERE banned_at IS NOT NULL ORDER BY banned_at DESC LIMIT 200',
    );
    const body: HiddenList = { items, banned: banned.map((u) => ({ id: u.id, pseudonym: u.pseudonym, bannedAt: u.banned_at.toISOString() })) };
    res.json(body);
  });

  r.post('/admin/users/:id/ban', async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    if (id === me.id) fail(400, 'You cannot ban yourself.', 'invalid_input');
    const out = await db.tx(async (q) => {
      const user = await q.maybeOne<{ role: string; is_system: boolean; banned_at: Date | null }>('SELECT role, is_system, banned_at FROM users WHERE id = $1', [id]);
      if (!user || user.is_system) fail(404, 'That member was not found.', 'not_found');
      if (user.role === 'admin') fail(409, 'Remove the admin role before banning this member.', 'is_admin');
      await q.query('UPDATE users SET banned_at = coalesce(banned_at, now()) WHERE id = $1', [id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      const recs = await q.query(`UPDATE recommendations SET hidden = true WHERE user_id = $1 AND NOT hidden RETURNING id`, [id]);
      const topics = await q.query(`UPDATE topics SET hidden = true WHERE user_id = $1 AND NOT hidden RETURNING id`, [id]);
      const replies = await q.query(`UPDATE replies SET hidden = true WHERE user_id = $1 AND NOT hidden RETURNING id`, [id]);
      // Listings they added are hidden unless another member has recommended or rated them:
      // a real place should not vanish because the person who added it was a spammer.
      const listings = await q.query(
        `UPDATE listings l SET hidden = true WHERE l.created_by = $1 AND NOT l.hidden
           AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.listing_id = l.id AND r.user_id <> $1 AND NOT r.hidden)
           AND NOT EXISTS (SELECT 1 FROM opinions o WHERE o.listing_id = l.id AND o.user_id <> $1)
         RETURNING id`,
        [id],
      );
      const photos = await q.query<{ blob_path: string }>(`UPDATE photos SET deleted_at = now() WHERE user_id = $1 AND deleted_at IS NULL RETURNING blob_path`, [id]);
      // Their votes stop counting: opinions and upvotes go. Unban does not bring them back.
      const opinions = await q.query('DELETE FROM opinions WHERE user_id = $1 RETURNING listing_id', [id]);
      const upvotes = await q.query('DELETE FROM upvotes WHERE user_id = $1 RETURNING target_id', [id]);
      await q.query('UPDATE listings SET owner_user_id = NULL, contact = NULL WHERE owner_user_id = $1', [id]);
      await q.query(`UPDATE claims SET status = 'rejected', decided_by = $2, decided_at = now() WHERE user_id = $1 AND status = 'pending'`, [id, me.id]);
      await resolveReports(q, 'user', id);
      const hidden = { recommendations: recs.length, topics: topics.length, replies: replies.length, listings: listings.length, photos: photos.length };
      await audit(q, { actorId: me.id, action: 'user.ban', targetType: 'user', targetId: id, detail: { hidden, removed: { opinions: opinions.length, upvotes: upvotes.length } } });
      return { hidden, blobPaths: photos.map((p) => p.blob_path) };
    });
    await deleteMedia(deps.media, out.blobPaths);
    res.json({ ok: true, hidden: out.hidden });
  });

  r.post('/admin/users/:id/unban', async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    await db.tx(async (q) => {
      const rows = await q.query('UPDATE users SET banned_at = NULL WHERE id = $1 AND banned_at IS NOT NULL RETURNING id', [id]);
      if (!rows.length) fail(404, 'That member is not banned.', 'not_found');
      await audit(q, { actorId: me.id, action: 'user.unban', targetType: 'user', targetId: id });
    });
    res.json({ ok: true });
  });

  // ---------- claims ----------

  r.get('/admin/claims', async (req, res) => {
    const all = req.query.status === 'all';
    const rows = await db.query<{ id: string; code: string; status: AdminClaim['status']; created_at: Date; decided_at: Date | null; user_id: string; pseudonym: string; listing_id: string; name: string; slug: string; kind: AdminClaim['listing']['kind']; owner_user_id: string | null }>(
      `SELECT c.id, c.code, c.status, c.created_at, c.decided_at, u.id AS user_id, u.pseudonym, l.id AS listing_id, l.name, l.slug, l.kind, l.owner_user_id
       FROM claims c JOIN users u ON u.id = c.user_id JOIN listings l ON l.id = c.listing_id
       ${all ? '' : "WHERE c.status = 'pending'"}
       ORDER BY (c.status = 'pending') DESC, c.created_at DESC LIMIT 200`,
    );
    const body: ClaimQueue = {
      claims: rows.map((x) => ({
        id: x.id,
        code: x.code,
        status: x.status,
        createdAt: x.created_at.toISOString(),
        decidedAt: x.decided_at ? x.decided_at.toISOString() : null,
        claimant: { id: x.user_id, pseudonym: x.pseudonym },
        listing: { id: x.listing_id, name: x.name, slug: x.slug, kind: x.kind, ownerRun: x.owner_user_id !== null },
      })),
    };
    res.json(body);
  });

  r.post('/admin/claims/:id/approve', async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    await db.tx(async (q) => {
      const claim = await q.maybeOne<{ listing_id: string; user_id: string; status: string; code: string }>(
        'SELECT listing_id, user_id, status, code FROM claims WHERE id = $1 FOR UPDATE', [id]);
      if (!claim) fail(404, 'That claim was not found.', 'not_found');
      if (claim.status !== 'pending') fail(409, 'That claim was already decided.', 'claim_decided');
      const listing = await q.one<{ owner_user_id: string | null; kind: string }>('SELECT owner_user_id, kind FROM listings WHERE id = $1 FOR UPDATE', [claim.listing_id]);
      if (listing.owner_user_id) fail(409, 'This listing already has an owner. Revoke them first.', 'already_owned');
      await q.query('UPDATE listings SET owner_user_id = $1 WHERE id = $2', [claim.user_id, claim.listing_id]);
      await q.query(`UPDATE claims SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1`, [id, me.id]);
      // Other members' pending claims on the same listing lose.
      await q.query(
        `UPDATE claims SET status = 'rejected', decided_by = $2, decided_at = now() WHERE listing_id = $1 AND status = 'pending'`,
        [claim.listing_id, me.id],
      );
      if (listing.kind === 'service') await q.query('UPDATE users SET has_service = true WHERE id = $1', [claim.user_id]);
      await audit(q, { actorId: me.id, action: 'claim.approve', targetType: 'listing', targetId: claim.listing_id, detail: { claimId: id, code: claim.code, ownerId: claim.user_id } });
    });
    res.json({ ok: true });
  });

  r.post('/admin/claims/:id/reject', async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    await db.tx(async (q) => {
      const rows = await q.query<{ listing_id: string }>(
        `UPDATE claims SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING listing_id`,
        [id, me.id],
      );
      if (!rows.length) fail(409, 'That claim is not pending.', 'claim_decided');
      await audit(q, { actorId: me.id, action: 'claim.reject', targetType: 'listing', targetId: rows[0].listing_id, detail: { claimId: id } });
    });
    res.json({ ok: true });
  });

  r.post('/admin/claims/:id/revoke', async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    await db.tx(async (q) => {
      const claim = await q.maybeOne<{ listing_id: string; user_id: string; status: string }>('SELECT listing_id, user_id, status FROM claims WHERE id = $1', [id]);
      if (!claim || claim.status !== 'approved') fail(409, 'Only an approved claim can be revoked.', 'claim_not_approved');
      const owner = await q.one<{ owner_user_id: string | null }>('SELECT owner_user_id FROM listings WHERE id = $1', [claim.listing_id]);
      if (owner.owner_user_id === claim.user_id) await revokeOwner(q, me.id, claim.listing_id);
      else await q.query(`UPDATE claims SET status = 'revoked', decided_by = $2, decided_at = now() WHERE id = $1`, [id, me.id]);
    });
    res.json({ ok: true });
  });

  r.post('/admin/listings/:id/revoke-owner', async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    const changed = await db.tx((q) => revokeOwner(q, me.id, id));
    if (!changed) fail(409, 'This listing has no owner.', 'no_owner');
    res.json({ ok: true });
  });

  // Pin and unpin live in the Talk slice: POST /api/talk/topics/:id/pin { pinned }. The Admin screen calls that.

  // ---------- listings and merge ----------

  r.get('/admin/listings', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db.query<{ id: string; kind: AdminListings['listings'][number]['kind']; name: string; slug: string; area: string | null; hidden: boolean; owner_user_id: string | null; recs: number; opinions: number; created_at: Date }>(
      `SELECT l.id, l.kind, l.name, l.slug, l.area, l.hidden, l.owner_user_id, l.created_at,
              (SELECT count(*) FROM recommendations r WHERE r.listing_id = l.id) AS recs,
              (SELECT count(*) FROM opinions o WHERE o.listing_id = l.id) AS opinions
       FROM listings l WHERE ($1 = '' OR l.name ILIKE $2 OR l.slug ILIKE $2)
       ORDER BY l.created_at DESC LIMIT 50`,
      [q, like],
    );
    const body: AdminListings = {
      listings: rows.map((x) => ({
        id: x.id, kind: x.kind, name: x.name, slug: x.slug, area: x.area, hidden: x.hidden, ownerRun: x.owner_user_id !== null,
        recommendations: x.recs, opinions: x.opinions, createdAt: x.created_at.toISOString(),
      })),
    };
    res.json(body);
  });

  r.post('/admin/listings/merge', async (req, res) => {
    const me = currentUser(res);
    const { survivorId, loserId } = parse(mergeBody, req.body);
    if (survivorId === loserId) fail(400, 'Pick two different listings.', 'invalid_input');
    const moved = await db.tx(async (q) => {
      const both = await q.query<{ id: string; kind: string; owner_user_id: string | null; contact: unknown; hidden: boolean }>(
        'SELECT id, kind, owner_user_id, contact, hidden FROM listings WHERE id = ANY($1::uuid[]) FOR UPDATE', [[survivorId, loserId]]);
      const survivor = both.find((x) => x.id === survivorId);
      const loser = both.find((x) => x.id === loserId);
      if (!survivor || !loser) fail(404, 'That listing was not found.', 'not_found');
      if (survivor.kind !== loser.kind) fail(400, 'Only listings of the same kind can be merged.', 'invalid_input');

      const recs = await q.query('UPDATE recommendations SET listing_id = $1 WHERE listing_id = $2 RETURNING id', [survivorId, loserId]);
      // A member who rated both keeps the survivor's opinion; nobody gets two.
      const opinions = await q.query(
        `INSERT INTO opinions (listing_id, user_id, value, created_at)
         SELECT $1, user_id, value, created_at FROM opinions WHERE listing_id = $2
         ON CONFLICT (listing_id, user_id) DO NOTHING RETURNING user_id`,
        [survivorId, loserId],
      );
      await q.query('DELETE FROM opinions WHERE listing_id = $1', [loserId]);
      const bookmarks = await q.query(
        `INSERT INTO bookmarks (user_id, listing_id, created_at)
         SELECT user_id, $1, created_at FROM bookmarks WHERE listing_id = $2
         ON CONFLICT (user_id, listing_id) DO NOTHING RETURNING user_id`,
        [survivorId, loserId],
      );
      await q.query('DELETE FROM bookmarks WHERE listing_id = $1', [loserId]);
      const replies = await q.query(`UPDATE replies SET target_id = $1 WHERE target_type = 'listing' AND target_id = $2 RETURNING id`, [survivorId, loserId]);
      const topics = await q.query(
        `UPDATE topics SET listing_ids = (SELECT array_agg(DISTINCT x) FROM unnest(array_replace(listing_ids, $2::uuid, $1::uuid)) AS x)
         WHERE $2::uuid = ANY(listing_ids) RETURNING id`,
        [survivorId, loserId],
      );
      // An owner of the duplicate carries over when the survivor has none.
      if (loser.owner_user_id && !survivor.owner_user_id) {
        await q.query('UPDATE listings SET owner_user_id = $2, contact = coalesce(contact, $3) WHERE id = $1', [survivorId, loser.owner_user_id, loser.contact as Record<string, unknown> | null]);
        await q.query(`UPDATE claims SET listing_id = $1 WHERE listing_id = $2 AND status = 'approved'`, [survivorId, loserId]);
      }
      await q.query('UPDATE listings SET hidden = true, owner_user_id = NULL, contact = NULL WHERE id = $1', [loserId]);
      await q.query(`UPDATE claims SET status = 'rejected', decided_by = $2, decided_at = now() WHERE listing_id = $1 AND status = 'pending'`, [loserId, me.id]);
      await resolveReports(q, 'listing', loserId);
      const counts = { recommendations: recs.length, opinions: opinions.length, bookmarks: bookmarks.length, replies: replies.length, topics: topics.length };
      await audit(q, { actorId: me.id, action: 'listing.merge', targetType: 'listing', targetId: survivorId, detail: { loserId, moved: counts } });
      return counts;
    });
    const body: MergeResult = { moved };
    res.json(body);
  });

  // ---------- audit ----------

  r.get('/admin/audit', async (req, res) => {
    const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
    const rows = await db.query<{ id: string; action: string; actor: string | null; target_type: string | null; target_id: string | null; detail: Record<string, unknown>; created_at: Date }>(
      `SELECT a.id, a.action, u.pseudonym AS actor, a.target_type, a.target_id, a.detail, a.created_at
       FROM audit a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ($1::timestamptz IS NULL OR a.created_at < $1)
       ORDER BY a.created_at DESC LIMIT 51`,
      [before],
    );
    const page = rows.slice(0, 50);
    const body: AuditPage = {
      rows: page.map((x) => ({ id: x.id, action: x.action, actor: x.actor, targetType: x.target_type, targetId: x.target_id, detail: x.detail, createdAt: x.created_at.toISOString() })),
      next: rows.length > 50 ? page[page.length - 1].created_at.toISOString() : null,
    };
    res.json(body);
  });

  return r;
}
