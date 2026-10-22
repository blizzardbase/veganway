// The member's own space. GET /api/me itself belongs to routes/auth.ts; password change is POST /api/auth/password.
// Mounted at /api. This router owns:
//   GET   /me/profile      PATCH /me/profile     display name, bio, avatar photo, theme
//   GET   /me/posts        listings, recommendations, topics and replies I wrote
//   GET   /me/saved        my bookmarks (private)
//   GET   /me/service      the service I run, and my pending claims
//   POST  /me/delete       { password }: delete the account, keep the posts as "Former member"
import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { audit } from '../lib/audit.js';
import { clearSessionCookie, currentUser, loadUser, requireUser, toMe } from '../lib/auth.js';
import { rejectContact } from '../lib/contact.js';
import { fail, parse } from '../lib/http.js';
import { deleteMedia } from '../lib/media.js';
import { isReservedName } from '../lib/pseudonym.js';
import { limit } from '../lib/rate.js';
import { PASSWORD_MAX, type MeResponse } from '../../shared/types.js';
import {
  DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, FORMER_MEMBER,
  type MyPosts, type MySaved, type MyService, type Profile, type ThemePreference,
} from '../../shared/types/me.js';
import { BIO_MAX } from '../../shared/types/services.js';

const displayName = z.union([
  z.string({ error: 'Enter a display name.' }).trim()
    .min(DISPLAY_NAME_MIN, { error: `Use at least ${DISPLAY_NAME_MIN} characters, or leave it empty.` })
    .max(DISPLAY_NAME_MAX, { error: `Use at most ${DISPLAY_NAME_MAX} characters.` }),
  z.null(),
]);
const bio = z.union([z.string({ error: 'Enter a bio.' }).trim().max(BIO_MAX, { error: `Use at most ${BIO_MAX} characters.` }), z.null()]);
const profileBody = z.object({
  displayName: displayName.optional(),
  bio: bio.optional(),
  avatarPhotoId: z.union([z.uuid({ error: 'That photo was not found.' }), z.null()]).optional(),
  theme: z.enum(['system', 'light', 'dark'], { error: 'Pick System, Light or Dark.' }).optional(),
}).strict();
const deleteBody = z.object({
  password: z.string({ error: 'Enter your password.' }).min(1, { error: 'Enter your password.' }).max(PASSWORD_MAX, { error: 'Your password is wrong.' }),
});

interface ProfileRow {
  pseudonym: string;
  display_name: string | null;
  bio: string | null;
  avatar_photo_id: string | null;
  blob_path: string | null;
  theme: ThemePreference;
  has_service: boolean;
  role: 'member' | 'admin';
}

const toProfile = (r: ProfileRow): Profile => ({
  pseudonym: r.pseudonym,
  displayName: r.display_name,
  bio: r.bio,
  avatarPhotoId: r.blob_path ? r.avatar_photo_id : null,
  avatarUrl: r.blob_path ? `/media/${r.blob_path}` : null,
  theme: r.theme,
  hasService: r.has_service,
  role: r.role,
});

type Kind = 'place' | 'product' | 'service';

export function router(deps: Deps): Router {
  const r = Router();
  const { db, passwords, limits } = deps;

  const readProfile = (id: string) => db.one<ProfileRow>(
    `SELECT u.pseudonym, u.display_name, u.bio, u.avatar_photo_id, p.blob_path, u.theme, u.has_service, u.role
     FROM users u LEFT JOIN photos p ON p.id = u.avatar_photo_id AND p.deleted_at IS NULL AND NOT p.hidden WHERE u.id = $1`,
    [id],
  );

  r.get('/me/profile', requireUser, async (_req, res) => {
    const me = currentUser(res);
    res.json(toProfile(await readProfile(me.id)));
  });

  r.patch('/me/profile', requireUser, async (req, res) => {
    const me = currentUser(res);
    const body = parse(profileBody, req.body);
    // Empty strings clear a field, the same as null.
    const name = body.displayName === '' ? null : body.displayName;
    const about = body.bio === '' ? null : body.bio;
    if (name) {
      rejectContact(name);
      if (isReservedName(name)) fail(400, 'Please pick a different name. That one reads like an official role.', 'reserved_name', 'displayName');
    }
    if (about) rejectContact(about);
    if (body.avatarPhotoId) {
      const ok = await db.maybeOne('SELECT 1 FROM photos WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND NOT hidden', [body.avatarPhotoId, me.id]);
      if (!ok) fail(400, 'That photo was not found. Please add it again.', 'invalid_input', 'avatarPhotoId');
    }
    const sets: string[] = [];
    const params: (string | null)[] = [];
    const set = (col: string, value: string | null) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (name !== undefined) set('display_name', name);
    if (about !== undefined) set('bio', about);
    if (body.avatarPhotoId !== undefined) set('avatar_photo_id', body.avatarPhotoId);
    if (body.theme !== undefined) set('theme', body.theme);
    if (sets.length) {
      params.push(me.id);
      await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    const user = await loadUser(db, me.id);
    if (!user) fail(401, 'Please sign in first.', 'signed_out');
    const session: MeResponse = { user: toMe(user), csrf: res.locals.session!.csrf };
    res.json({ profile: toProfile(await readProfile(me.id)), ...session });
  });

  r.get('/me/posts', requireUser, async (_req, res) => {
    const me = currentUser(res);
    const [listings, recs, topics, replies] = await Promise.all([
      db.query<{ id: string; kind: Kind; name: string; slug: string; hidden: boolean; created_at: Date }>(
        'SELECT id, kind, name, slug, hidden, created_at FROM listings WHERE created_by = $1 ORDER BY created_at DESC LIMIT 50', [me.id]),
      db.query<{ id: string; body: string; offer: string | null; hidden: boolean; created_at: Date; name: string; slug: string; kind: Kind }>(
        `SELECT r.id, r.body, r.offer, r.hidden, r.created_at, l.name, l.slug, l.kind
         FROM recommendations r JOIN listings l ON l.id = r.listing_id WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [me.id]),
      db.query<{ id: string; kind: 'discussion' | 'poll'; title: string; hidden: boolean; created_at: Date }>(
        'SELECT id, kind, title, hidden, created_at FROM topics WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [me.id]),
      db.query<{ id: string; body: string; hidden: boolean; created_at: Date; target_type: 'listing' | 'topic'; target_id: string; t_title: string | null; l_name: string | null; l_slug: string | null; l_kind: Kind | null }>(
        `SELECT x.id, x.body, x.hidden, x.created_at, x.target_type, x.target_id, t.title AS t_title, l.name AS l_name, l.slug AS l_slug, l.kind AS l_kind
         FROM replies x
         LEFT JOIN topics t ON x.target_type = 'topic' AND t.id = x.target_id
         LEFT JOIN listings l ON x.target_type = 'listing' AND l.id = x.target_id
         WHERE x.user_id = $1 AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 50`, [me.id]),
    ]);
    const body: MyPosts = {
      listings: listings.map((x) => ({ id: x.id, kind: x.kind, name: x.name, slug: x.slug, hidden: x.hidden, createdAt: x.created_at.toISOString() })),
      recommendations: recs.map((x) => ({
        id: x.id, body: x.body, offer: x.offer, hidden: x.hidden, createdAt: x.created_at.toISOString(),
        listing: { name: x.name, slug: x.slug, kind: x.kind },
      })),
      topics: topics.map((x) => ({ id: x.id, kind: x.kind, title: x.title, hidden: x.hidden, createdAt: x.created_at.toISOString() })),
      replies: replies.map((x) => ({
        id: x.id, body: x.body, hidden: x.hidden, createdAt: x.created_at.toISOString(),
        on: x.target_type === 'topic' && x.t_title !== null
          ? { type: 'topic' as const, id: x.target_id, title: x.t_title }
          : x.target_type === 'listing' && x.l_name !== null && x.l_slug !== null && x.l_kind !== null
            ? { type: 'listing' as const, id: x.target_id, name: x.l_name, slug: x.l_slug, kind: x.l_kind }
            : null,
      })),
    };
    res.json(body);
  });

  r.get('/me/saved', requireUser, async (_req, res) => {
    const me = currentUser(res);
    const rows = await db.query<{ id: string; kind: Kind; name: string; slug: string; category: string; area: string | null; vegan_status: string; saved_at: Date }>(
      `SELECT l.id, l.kind, l.name, l.slug, l.category, l.area, l.vegan_status, b.created_at AS saved_at
       FROM bookmarks b JOIN listings l ON l.id = b.listing_id
       WHERE b.user_id = $1 AND NOT l.hidden ORDER BY b.created_at DESC LIMIT 200`,
      [me.id],
    );
    const body: MySaved = {
      items: rows.map((x) => ({ id: x.id, kind: x.kind, name: x.name, slug: x.slug, category: x.category, area: x.area, veganStatus: x.vegan_status, savedAt: x.saved_at.toISOString() })),
    };
    res.json(body);
  });

  r.get('/me/service', requireUser, async (_req, res) => {
    const me = currentUser(res);
    const service = await db.maybeOne<{ id: string; name: string; slug: string; kind: Kind }>(
      `SELECT id, name, slug, kind FROM listings WHERE owner_user_id = $1 AND NOT hidden
       ORDER BY (kind = 'service') DESC, created_at ASC LIMIT 1`,
      [me.id],
    );
    const claims = await db.query<{ id: string; code: string; created_at: Date; name: string; slug: string; kind: Kind }>(
      `SELECT c.id, c.code, c.created_at, l.name, l.slug, l.kind FROM claims c JOIN listings l ON l.id = c.listing_id
       WHERE c.user_id = $1 AND c.status = 'pending' ORDER BY c.created_at DESC`,
      [me.id],
    );
    const body: MyService = {
      service,
      pendingClaims: claims.map((c) => ({ id: c.id, code: c.code, createdAt: c.created_at.toISOString(), listing: { name: c.name, slug: c.slug, kind: c.kind } })),
    };
    res.json(body);
  });

  // Delete the account. Sessions, credentials, the avatar and loose photos go; posts stay under "Former member".
  r.post('/me/delete', requireUser, async (req, res) => {
    const me = currentUser(res);
    const body = parse(deleteBody, req.body);
    await limit(db, `password:${me.id}`, limits.passwordChange);
    const row = await db.one<{ pw_hash: string }>('SELECT pw_hash FROM users WHERE id = $1', [me.id]);
    if (!(await passwords.verify(body.password, row.pw_hash))) fail(401, 'Your password is wrong.', 'bad_credentials', 'password');
    const blobPaths = await db.tx(async (q) => {
      const current = await q.maybeOne(
        `SELECT id FROM users WHERE id = $1 AND pw_hash = $2
         AND banned_at IS NULL AND deleted_at IS NULL AND NOT is_system FOR UPDATE`,
        [me.id, row.pw_hash],
      );
      if (!current) fail(401, 'Your credentials changed. Please sign in again.', 'bad_credentials');
      await q.query('DELETE FROM sessions WHERE user_id = $1', [me.id]);
      await q.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [me.id]);
      // The avatar goes, and so does every photo they uploaded that no visible listing or
      // recommendation still shows. Photos on posts that stay keep showing under "Former member".
      const { avatar_photo_id: avatarId } = await q.one<{ avatar_photo_id: string | null }>('SELECT avatar_photo_id FROM users WHERE id = $1', [me.id]);
      const photos = await q.query<{ blob_path: string }>(
        `UPDATE photos p SET deleted_at = now()
         WHERE p.user_id = $1 AND p.deleted_at IS NULL
           AND (p.id = $2::uuid
             OR (NOT EXISTS (SELECT 1 FROM listings l WHERE l.photo_id = p.id AND NOT l.hidden)
                 AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.photo_id = p.id AND NOT r.hidden)))
         RETURNING p.blob_path`,
        [me.id, avatarId],
      );
      await q.query(
        `UPDATE users SET email_hmac = NULL, pw_hash = NULL, pseudonym = $2,
           display_name = NULL, bio = NULL, avatar_photo_id = NULL, has_service = false, role = 'member',
           theme = 'system', profile_hidden = false, deleted_at = now()
         WHERE id = $1`,
        [me.id, FORMER_MEMBER],
      );
      // The business stays listed, but nobody runs it now, so it can be claimed again. Contact details were theirs.
      await q.query('UPDATE listings SET owner_user_id = NULL, contact = NULL WHERE owner_user_id = $1', [me.id]);
      await q.query(`UPDATE claims SET status = 'rejected', decided_at = now() WHERE user_id = $1 AND status = 'pending'`, [me.id]);
      // Saved items are private and mean nothing without the member.
      await q.query('DELETE FROM bookmarks WHERE user_id = $1', [me.id]);
      await audit(q, { actorId: me.id, action: 'account.delete', targetType: 'user', targetId: me.id, detail: { photosDeleted: photos.length } });
      return photos.map((p) => p.blob_path);
    });
    await deleteMedia(deps.media, blobPaths, db);
    clearSessionCookie(deps, res);
    res.json({ ok: true, user: null, csrf: null });
  });

  return r;
}
