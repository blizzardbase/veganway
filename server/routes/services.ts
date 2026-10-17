// Services and claims. A service is a listings row with kind 'service'.
// Mounted at /api. This router owns: /services, /services/:slug, /services/:id (PATCH), /services/:id/claim.
// The admin side of claims (approve, reject, revoke) lives in routes/admin.ts.
import { randomBytes, randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { isUniqueViolation, type Queryable } from '../db.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { checkCap } from '../lib/caps.js';
import { rejectContact } from '../lib/contact.js';
import { fail, parse } from '../lib/http.js';
import { VEGAN_STATUS_REQUIRED } from '../../shared/types/listings.js';
import {
  SERVICE_CATEGORIES, SERVICE_NAME_MAX, SERVICE_VEGAN_STATUSES, SERVICE_SUMMARY_MAX,
  type ClaimResponse, type MyClaim, type ServiceContact, type ServiceCreated, type ServiceProfile,
} from '../../shared/types/services.js';

// ---------- contact fields ----------

/** WhatsApp: a number in international form, or a wa.me / api.whatsapp.com link. Returns digits or throws. */
export function normalizeWhatsapp(input: string): string {
  let s = input.trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)\+?([0-9]+)\/?(?:\?.*)?$/i);
  if (link) s = link[1];
  else if (/[a-z]/i.test(s)) fail(400, 'Enter a WhatsApp number such as +971 50 123 4567, or a wa.me link.', 'invalid_input', 'contact.whatsapp');
  let digits = s.replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]+$/.test(digits)) fail(400, 'Enter a WhatsApp number such as +971 50 123 4567, or a wa.me link.', 'invalid_input', 'contact.whatsapp');
  digits = digits.replace(/^\+/, '').replace(/^00/, '');
  // A UAE mobile number typed the local way, 05X XXX XXXX.
  if (/^05[0-9]{8}$/.test(digits)) digits = `971${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) {
    fail(400, 'Enter the WhatsApp number with its country code, such as +971 50 123 4567.', 'invalid_input', 'contact.whatsapp');
  }
  return digits;
}

/** Instagram: @handle, handle, or an instagram.com link. Returns the handle or throws. */
export function normalizeInstagram(input: string): string {
  let s = input.trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (link) s = link[1];
  s = s.replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s) || /^\.|\.$|\.\./.test(s)) {
    fail(400, 'Enter an Instagram handle such as @yourbakery.', 'invalid_input', 'contact.instagram');
  }
  return s;
}

/** Website: an https URL with a real host name. Returns the normalized URL or throws. */
export function normalizeWebsite(input: string): string {
  const s = input.trim();
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    fail(400, 'Enter the full website address, starting with https://', 'invalid_input', 'contact.website');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || s.length > 200) {
    fail(400, 'Enter the full website address, starting with https://', 'invalid_input', 'contact.website');
  }
  return url.href;
}

const contactInput = z.object({
  whatsapp: z.string({ error: 'Enter a WhatsApp number.' }).max(80, { error: 'That WhatsApp number is too long.' }).optional(),
  instagram: z.string({ error: 'Enter an Instagram handle.' }).max(100, { error: 'That Instagram handle is too long.' }).optional(),
  website: z.string({ error: 'Enter a website.' }).max(200, { error: 'That website address is too long.' }).optional(),
}, { error: 'Contact details are not valid.' }).strict();

/** Validated contact, or null when every field is empty. */
export function buildContact(input: z.infer<typeof contactInput> | undefined): ServiceContact | null {
  if (!input) return null;
  const out: ServiceContact = {};
  if (input.whatsapp?.trim()) out.whatsapp = normalizeWhatsapp(input.whatsapp);
  if (input.instagram?.trim()) out.instagram = normalizeInstagram(input.instagram);
  if (input.website?.trim()) out.website = normalizeWebsite(input.website);
  return Object.keys(out).length ? out : null;
}

// ---------- schemas ----------

const uuid = z.uuid({ error: 'That item was not found.' });
const name = z.string({ error: 'Enter the name of your service.' }).trim()
  .min(2, { error: 'Enter the name of your service.' })
  .max(SERVICE_NAME_MAX, { error: `Use at most ${SERVICE_NAME_MAX} characters for the name.` });
const summary = z.string({ error: 'Say what you offer.' }).trim()
  .min(10, { error: 'Say a little more about what you offer.' })
  .max(SERVICE_SUMMARY_MAX, { error: `Use at most ${SERVICE_SUMMARY_MAX} characters.` });
const category = z.enum(SERVICE_CATEGORIES, { error: 'Pick a category.' });
const area = z.string({ error: 'Pick an area.' }).trim().min(2, { error: 'Pick an area.' }).max(60, { error: 'That area name is too long.' });
const photoId = z.union([uuid, z.null()]).optional();
// A service says itself whether everything is vegan. When a client leaves it out, store the
// modest claim, never "Fully vegan".
const veganStatus = z.enum(SERVICE_VEGAN_STATUSES, { error: VEGAN_STATUS_REQUIRED });

const createBody = z.object({ name, summary, category, area, veganStatus: veganStatus.optional(), photoId, contact: contactInput.optional() }).strict();
const updateBody = z.object({
  summary: summary.optional(), category: category.optional(), area: area.optional(), veganStatus: veganStatus.optional(), photoId, contact: contactInput.optional(),
})
  .strict();

// ---------- helpers ----------

export function slugify(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
}

function slugSuffix(): string {
  return randomBytes(4).toString('hex').slice(0, 5);
}

async function assertOwnPhoto(db: Queryable, userId: string, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const ok = await db.maybeOne('SELECT 1 FROM photos WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [id, userId]);
  if (!ok) fail(400, 'That photo was not found. Please add it again.', 'invalid_input', 'photoId');
}

export function newClaimCode(): string {
  return `VW-${String(randomInt(0, 10000)).padStart(4, '0')}`;
}

interface ListingRow {
  id: string;
  kind: 'place' | 'product' | 'service';
  name: string;
  slug: string;
  category: string;
  area: string | null;
  vegan_status: ServiceProfile['veganStatus'];
  summary: string;
  photo_id: string | null;
  blob_path: string | null;
  owner_user_id: string | null;
  contact: ServiceContact | null;
  created_at: Date;
  hidden: boolean;
}

interface ClaimRow {
  id: string;
  code: string;
  status: MyClaim['status'];
  created_at: Date;
}

const toClaim = (c: ClaimRow): MyClaim => ({ id: c.id, code: c.code, status: c.status, createdAt: c.created_at.toISOString() });

export function router(deps: Deps): Router {
  const r = Router();
  const { db } = deps;

  // Create a service. The creator owns it at once.
  r.post('/services', requireUser, async (req, res) => {
    const me = currentUser(res);
    const body = parse(createBody, req.body);
    rejectContact(body.name, body.summary, body.area);
    const contact = buildContact(body.contact);
    await assertOwnPhoto(db, me.id, body.photoId);
    const base = slugify(body.name) || 'service';
    for (let attempt = 0; attempt < 4; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${slugSuffix()}`;
      try {
        const row = await db.tx(async (q) => {
          await checkCap(q, me, 'listing');
          const created = await q.one<{ id: string; slug: string }>(
            `INSERT INTO listings (kind, name, slug, category, area, vegan_status, summary, owner_user_id, contact, photo_id, created_by)
             VALUES ('service', $1, $2, $3, $4, $9, $5, $6, $7, $8, $6) RETURNING id, slug`,
            [body.name, slug, body.category, body.area, body.summary, me.id, contact, body.photoId ?? null, body.veganStatus ?? 'vegan_options'],
          );
          await q.query('UPDATE users SET has_service = true WHERE id = $1', [me.id]);
          return created;
        });
        const out: ServiceCreated = { id: row.id, slug: row.slug };
        res.status(201).json(out);
        return;
      } catch (err) {
        if (!isUniqueViolation(err, 'listings_slug_key')) throw err;
      }
    }
    fail(503, 'Could not save that name. Please try again.');
  });

  // The public profile. Works signed out. Hidden listings are 404 except for admins.
  r.get('/services/:slug', async (req, res) => {
    const viewer = res.locals.session?.user ?? null;
    const isAdmin = viewer?.role === 'admin';
    const row = await db.maybeOne<ListingRow>(
      `SELECT l.id, l.kind, l.name, l.slug, l.category, l.area, l.vegan_status, l.summary, l.photo_id, p.blob_path, l.owner_user_id, l.contact, l.created_at, l.hidden
       FROM listings l LEFT JOIN photos p ON p.id = l.photo_id AND p.deleted_at IS NULL
       WHERE l.slug = $1`,
      [String(req.params.slug)],
    );
    if (!row || (row.hidden && !isAdmin)) fail(404, 'This service was not found.', 'not_found');

    const counts = await db.one<{ recommend: number; not_for_me: number; recommendations: number }>(
      `SELECT (SELECT count(*) FROM opinions WHERE listing_id = $1 AND value = 'recommend') AS recommend,
              (SELECT count(*) FROM opinions WHERE listing_id = $1 AND value = 'not_for_me') AS not_for_me,
              (SELECT count(*) FROM recommendations WHERE listing_id = $1 AND NOT hidden) AS recommendations`,
      [row.id],
    );
    const recs = await db.query<{ id: string; body: string; offer: string | null; offer_expires_at: Date | null; author: string; upvotes: number; created_at: Date }>(
      `SELECT r.id, r.body, r.offer, r.offer_expires_at, u.pseudonym AS author, r.created_at,
              (SELECT count(*) FROM upvotes v WHERE v.target_type = 'recommendation' AND v.target_id = r.id) AS upvotes
       FROM recommendations r JOIN users u ON u.id = r.user_id
       WHERE r.listing_id = $1 AND NOT r.hidden
       ORDER BY upvotes DESC, r.created_at DESC LIMIT 20`,
      [row.id],
    );

    let viewerBlock: ServiceProfile['viewer'] = null;
    if (viewer) {
      const extra = await db.one<{ opinion: 'recommend' | 'not_for_me' | null; saved: boolean }>(
        `SELECT (SELECT value FROM opinions WHERE listing_id = $1 AND user_id = $2) AS opinion,
                EXISTS (SELECT 1 FROM bookmarks WHERE listing_id = $1 AND user_id = $2) AS saved`,
        [row.id, viewer.id],
      );
      const claim = await db.maybeOne<ClaimRow>(
        `SELECT id, code, status, created_at FROM claims WHERE listing_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [row.id, viewer.id],
      );
      viewerBlock = { isOwner: row.owner_user_id === viewer.id, opinion: extra.opinion, saved: extra.saved, claim: claim ? toClaim(claim) : null };
    }

    const ownerRun = row.owner_user_id !== null;
    const body: ServiceProfile = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      slug: row.slug,
      category: row.category,
      area: row.area,
      veganStatus: row.vegan_status,
      summary: row.summary,
      photoId: row.blob_path ? row.photo_id : null,
      photoUrl: row.blob_path ? `/media/${row.blob_path}` : null,
      ownerRun,
      // Contact details belong to the owner, so they show only while someone runs the listing.
      contact: ownerRun && row.kind === 'service' ? row.contact : null,
      createdAt: row.created_at.toISOString(),
      counts: { recommend: counts.recommend, notForMe: counts.not_for_me, recommendations: counts.recommendations },
      viewer: viewerBlock,
      recommendations: recs.map((x) => ({
        id: x.id,
        body: x.body,
        offer: x.offer,
        offerExpiresAt: x.offer_expires_at ? x.offer_expires_at.toISOString() : null,
        author: x.author,
        upvotes: x.upvotes,
        createdAt: x.created_at.toISOString(),
      })),
    };
    res.json(body);
  });

  // Owner (or admin) edits the description, category, area, photo and contact details.
  // The schema is strict: there is no field here that touches recommendations, replies or opinions.
  r.patch('/services/:id', requireUser, async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    const body = parse(updateBody, req.body);
    const row = await db.maybeOne<{ kind: string; owner_user_id: string | null; hidden: boolean }>(
      'SELECT kind, owner_user_id, hidden FROM listings WHERE id = $1',
      [id],
    );
    if (!row || (row.hidden && me.role !== 'admin')) fail(404, 'This listing was not found.', 'not_found');
    if (row.owner_user_id !== me.id && me.role !== 'admin') fail(403, 'Only the owner can edit this listing.', 'not_owner');
    if (body.contact !== undefined && row.kind !== 'service') {
      fail(400, 'Only a service listing can show contact details.', 'contact_service_only', 'contact');
    }
    if (row.kind !== 'service' && (body.category !== undefined || body.area !== undefined || body.veganStatus !== undefined)) {
      fail(400, 'Only the description and photo of this listing can be edited here.', 'invalid_input');
    }
    rejectContact(body.summary, body.area);
    const contact = body.contact !== undefined ? buildContact(body.contact) : undefined;
    await assertOwnPhoto(db, me.id, body.photoId);

    const sets: string[] = [];
    const params: (string | null | ServiceContact)[] = [];
    const set = (col: string, value: string | null | ServiceContact) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (body.summary !== undefined) set('summary', body.summary);
    if (body.category !== undefined) set('category', body.category);
    if (body.area !== undefined) set('area', body.area);
    if (body.veganStatus !== undefined) set('vegan_status', body.veganStatus);
    if (body.photoId !== undefined) set('photo_id', body.photoId);
    if (contact !== undefined) set('contact', contact);
    if (sets.length) {
      params.push(id);
      await db.query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    }
    res.json({ ok: true });
  });

  // "This is my business": a pending claim with a code the member sends to an admin on WhatsApp.
  r.post('/services/:id/claim', requireUser, async (req, res) => {
    const me = currentUser(res);
    const id = parse(uuid, req.params.id);
    const listing = await db.maybeOne<{ owner_user_id: string | null; hidden: boolean }>(
      'SELECT owner_user_id, hidden FROM listings WHERE id = $1',
      [id],
    );
    if (!listing || listing.hidden) fail(404, 'This listing was not found.', 'not_found');
    if (listing.owner_user_id) fail(409, 'This listing is already run by its owner.', 'already_owned');
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const claim = await db.one<ClaimRow>(
          `INSERT INTO claims (listing_id, user_id, code) VALUES ($1, $2, $3) RETURNING id, code, status, created_at`,
          [id, me.id, newClaimCode()],
        );
        const out: ClaimResponse = { claim: toClaim(claim) };
        res.status(201).json(out);
        return;
      } catch (err) {
        if (isUniqueViolation(err, 'claims_pending_member_key')) {
          fail(409, 'You already asked to claim this listing. Send your code to an admin on WhatsApp.', 'claim_pending');
        }
        if (!isUniqueViolation(err, 'claims_pending_code_key')) throw err;
      }
    }
    fail(503, 'Could not make a code. Please try again.');
  });

  return r;
}
