import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { asAdmin, makeTestApp, signUp, type TestApp } from '../helpers.js';
import { normalizeInstagram, normalizeWebsite, normalizeWhatsapp } from '../../server/routes/services.js';
import type { ClaimResponse, ServiceCreated, ServiceProfile } from '../../shared/types/services.js';
import type { Me } from '../../shared/types.js';

const SERVICE = {
  name: 'Basil Bakes',
  summary: 'Vegan sourdough and birthday cakes, baked to order every weekend.',
  category: 'Home baker',
  area: 'Delivers across Dubai',
  contact: { whatsapp: '+971 50 123 4567', instagram: '@basilbakes', website: 'https://basilbakes.example' },
};

/** A place added straight into the database (the Listings routes belong to another slice). */
async function insertPlace(app: TestApp, createdBy: string, name = 'Green Fork Cafe'): Promise<string> {
  const row = await app.db.one<{ id: string }>(
    `INSERT INTO listings (kind, name, slug, area, vegan_status, summary, created_by)
     VALUES ('place', $1, $2, 'JLT', 'fully_vegan', 'All plant based.', $3) RETURNING id`,
    [name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`, createdBy],
  );
  return row.id;
}

describe('contact field normalizers', () => {
  test('WhatsApp accepts international, local UAE and wa.me forms', () => {
    assert.equal(normalizeWhatsapp('+971 50 123 4567'), '971501234567');
    assert.equal(normalizeWhatsapp('0501234567'), '971501234567');
    assert.equal(normalizeWhatsapp('00971501234567'), '971501234567');
    assert.equal(normalizeWhatsapp('https://wa.me/971501234567'), '971501234567');
    assert.equal(normalizeWhatsapp('wa.me/+971501234567'), '971501234567');
    assert.throws(() => normalizeWhatsapp('call me'));
    assert.throws(() => normalizeWhatsapp('12345'));
    assert.throws(() => normalizeWhatsapp('https://evil.example/971501234567'));
  });
  test('Instagram accepts a handle or a profile link', () => {
    assert.equal(normalizeInstagram('@basil.bakes'), 'basil.bakes');
    assert.equal(normalizeInstagram('https://www.instagram.com/basil_bakes/'), 'basil_bakes');
    assert.throws(() => normalizeInstagram('not a handle!'));
    assert.throws(() => normalizeInstagram('https://instagram.evil.example/x'));
  });
  test('website must be https', () => {
    assert.equal(normalizeWebsite('https://basilbakes.example'), 'https://basilbakes.example/');
    assert.throws(() => normalizeWebsite('http://basilbakes.example'));
    assert.throws(() => normalizeWebsite('javascript:alert(1)'));
    assert.throws(() => normalizeWebsite('https://user:pw@basilbakes.example'));
    assert.throws(() => normalizeWebsite('basilbakes.example'));
  });
});

describe('services', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('create sets the creator as owner, stores validated contact, and marks has_service', async () => {
    const owner = await signUp(app.agent());
    const res = await owner.agent.post<ServiceCreated>('/api/services', SERVICE);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await app.db.one<{ kind: string; owner_user_id: string; created_by: string; contact: Record<string, string> }>(
      'SELECT kind, owner_user_id, created_by, contact FROM listings WHERE id = $1', [res.body.id]);
    assert.equal(row.kind, 'service');
    assert.equal(row.owner_user_id, owner.user.id);
    assert.equal(row.created_by, owner.user.id);
    assert.deepEqual(row.contact, { whatsapp: '971501234567', instagram: 'basilbakes', website: 'https://basilbakes.example/' });
    const me = await owner.agent.get<{ user: Me }>('/api/me');
    assert.equal(me.body.user.hasService, true);

    // The public profile shows the owner's contact links, signed out too.
    const pub = await app.agent().get<ServiceProfile>(`/api/services/${res.body.slug}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.ownerRun, true);
    assert.equal(pub.body.contact?.whatsapp, '971501234567');
    assert.equal(pub.body.viewer, null);
    const mine = await owner.agent.get<ServiceProfile>(`/api/services/${res.body.slug}`);
    assert.equal(mine.body.viewer?.isOwner, true);
  });

  test('vegan status: the chosen value is stored and shown, a missing one is never Fully vegan', async () => {
    const m = await signUp(app.agent());
    const statusOf = async (id: string) =>
      (await app.db.one<{ vegan_status: string }>('SELECT vegan_status FROM listings WHERE id = $1', [id])).vegan_status;

    const options = await m.agent.post<ServiceCreated>('/api/services', { ...SERVICE, name: 'Options Kitchen', veganStatus: 'vegan_options' });
    assert.equal(options.status, 201, JSON.stringify(options.body));
    assert.equal(await statusOf(options.body.id), 'vegan_options');
    const shown = await app.agent().get<ServiceProfile>(`/api/services/${options.body.slug}`);
    assert.equal(shown.body.veganStatus, 'vegan_options');

    const full = await m.agent.post<ServiceCreated>('/api/services', { ...SERVICE, name: 'Fully Plant Kitchen', veganStatus: 'fully_vegan' });
    assert.equal(full.status, 201);
    assert.equal(await statusOf(full.body.id), 'fully_vegan');

    const silent = await m.agent.post<ServiceCreated>('/api/services', { ...SERVICE, name: 'Quiet Kitchen' });
    assert.equal(silent.status, 201);
    assert.equal(await statusOf(silent.body.id), 'vegan_options');

    const product = await m.agent.post('/api/services', { ...SERVICE, name: 'Wrong Kitchen', veganStatus: 'vegan_product' });
    assert.equal(product.status, 400);

    // The owner can change it later.
    const edit = await m.agent.patch(`/api/services/${options.body.id}`, { veganStatus: 'fully_vegan' });
    assert.equal(edit.status, 200);
    assert.equal(await statusOf(options.body.id), 'fully_vegan');
  });

  test('create validates every contact field and rejects contact details in free text', async () => {
    const m = await signUp(app.agent());
    const badWa = await m.agent.post('/api/services', { ...SERVICE, contact: { whatsapp: 'ring me' } });
    assert.equal(badWa.status, 400);
    assert.equal((badWa.body as { field: string }).field, 'contact.whatsapp');
    const badWeb = await m.agent.post('/api/services', { ...SERVICE, contact: { website: 'http://insecure.example' } });
    assert.equal(badWeb.status, 400);
    assert.equal((badWeb.body as { field: string }).field, 'contact.website');
    const badIg = await m.agent.post('/api/services', { ...SERVICE, contact: { instagram: 'no spaces allowed' } });
    assert.equal(badIg.status, 400);
    const extra = await m.agent.post('/api/services', { ...SERVICE, contact: { email: 'x@y.example' } });
    assert.equal(extra.status, 400);
    const inText = await m.agent.post('/api/services', { ...SERVICE, summary: 'Cakes to order, call 050 123 4567 any time.' });
    assert.equal(inText.status, 400);
    assert.equal((inText.body as { code: string }).code, 'contact_details');
    const badCategory = await m.agent.post('/api/services', { ...SERVICE, category: 'Plumber' });
    assert.equal(badCategory.status, 400);
    const signedOut = await app.agent().post('/api/services', SERVICE);
    assert.equal(signedOut.status, 401);
  });

  test('contact fields are rejected on a place, by the API and by the database', async () => {
    const m = await signUp(app.agent());
    const placeId = await insertPlace(app, m.user.id);
    await app.db.query('UPDATE listings SET owner_user_id = $1 WHERE id = $2', [m.user.id, placeId]);
    const res = await m.agent.patch(`/api/services/${placeId}`, { contact: { instagram: '@greenfork' } });
    assert.equal(res.status, 400);
    assert.equal((res.body as { code: string }).code, 'contact_service_only');
    await assert.rejects(app.db.query(`UPDATE listings SET contact = '{"instagram":"x"}' WHERE id = $1`, [placeId]));
  });

  test('owner edits description and contact; a non owner gets 403', async () => {
    const owner = await signUp(app.agent());
    const other = await signUp(app.agent());
    const { body: created } = await owner.agent.post<ServiceCreated>('/api/services', { ...SERVICE, name: 'Tahini Kitchen' });
    const edit = await owner.agent.patch(`/api/services/${created.id}`, {
      summary: 'Now also weekly meal prep boxes, all plant based.',
      contact: { instagram: '@tahinikitchen', whatsapp: '' },
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    const row = await app.db.one<{ summary: string; contact: Record<string, string> }>('SELECT summary, contact FROM listings WHERE id = $1', [created.id]);
    assert.match(row.summary, /meal prep/);
    assert.deepEqual(row.contact, { instagram: 'tahinikitchen' });
    const denied = await other.agent.patch(`/api/services/${created.id}`, { summary: 'I took over this listing, honestly.' });
    assert.equal(denied.status, 403);
  });

  test('owner cannot hide or edit a member recommendation', async () => {
    const owner = await signUp(app.agent());
    const member = await signUp(app.agent());
    const { body: created } = await owner.agent.post<ServiceCreated>('/api/services', { ...SERVICE, name: 'Cardamom Catering' });
    const rec = await app.db.one<{ id: string }>(
      `INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, 'The cake was dry this time.') RETURNING id`,
      [created.id, member.user.id],
    );
    // The edit schema is strict: there is no field for recommendations.
    const viaEdit = await owner.agent.patch(`/api/services/${created.id}`, { hiddenRecommendations: [rec.id] });
    assert.equal(viaEdit.status, 400);
    // Moderation is admin only.
    const viaAdmin = await owner.agent.post('/api/admin/moderate', { targetType: 'recommendation', targetId: rec.id, action: 'hide' });
    assert.equal(viaAdmin.status, 403);
    const still = await app.db.one<{ hidden: boolean; body: string }>('SELECT hidden, body FROM recommendations WHERE id = $1', [rec.id]);
    assert.equal(still.hidden, false);
    assert.equal(still.body, 'The cake was dry this time.');
    const pub = await app.agent().get<ServiceProfile>(`/api/services/${created.slug}`);
    assert.equal(pub.body.recommendations.length, 1);
  });

  test('claim: code, one pending per member, admin approve sets owner and audit, revoke clears it', async () => {
    const adder = await signUp(app.agent());
    const realOwner = await signUp(app.agent());
    const admin = await asAdmin(app);
    const placeId = await insertPlace(app, adder.user.id, 'Falafel Corner');

    const claim = await realOwner.agent.post<ClaimResponse>(`/api/services/${placeId}/claim`);
    assert.equal(claim.status, 201, JSON.stringify(claim.body));
    assert.match(claim.body.claim.code, /^VW-\d{4}$/);
    assert.equal(claim.body.claim.status, 'pending');

    const again = await realOwner.agent.post(`/api/services/${placeId}/claim`);
    assert.equal(again.status, 409);
    assert.equal((again.body as { code: string }).code, 'claim_pending');

    const queue = await admin.agent.get<{ claims: { id: string; code: string }[] }>('/api/admin/claims');
    const row = queue.body.claims.find((c) => c.id === claim.body.claim.id);
    assert.equal(row?.code, claim.body.claim.code);

    const approve = await admin.agent.post(`/api/admin/claims/${claim.body.claim.id}/approve`);
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    const listing = await app.db.one<{ owner_user_id: string }>('SELECT owner_user_id FROM listings WHERE id = $1', [placeId]);
    assert.equal(listing.owner_user_id, realOwner.user.id);
    const auditRow = await app.db.one<{ actor_id: string; detail: { ownerId: string } }>(
      `SELECT actor_id, detail FROM audit WHERE action = 'claim.approve' AND target_id = $1`, [placeId]);
    assert.equal(auditRow.actor_id, admin.user.id);
    assert.equal(auditRow.detail.ownerId, realOwner.user.id);

    // Once owned, nobody can claim it.
    const late = await adder.agent.post(`/api/services/${placeId}/claim`);
    assert.equal(late.status, 409);

    const revoke = await admin.agent.post(`/api/admin/listings/${placeId}/revoke-owner`);
    assert.equal(revoke.status, 200);
    const after = await app.db.one<{ owner_user_id: string | null }>('SELECT owner_user_id FROM listings WHERE id = $1', [placeId]);
    assert.equal(after.owner_user_id, null);
    const status = await app.db.one<{ status: string }>('SELECT status FROM claims WHERE id = $1', [claim.body.claim.id]);
    assert.equal(status.status, 'revoked');
    assert.ok(await app.db.maybeOne(`SELECT 1 FROM audit WHERE action = 'ownership.revoke' AND target_id = $1`, [placeId]));
  });

  test('admin can reject a claim, and non admins cannot approve', async () => {
    const adder = await signUp(app.agent());
    const claimer = await signUp(app.agent());
    const admin = await asAdmin(app);
    const placeId = await insertPlace(app, adder.user.id, 'Mango Lane');
    const { body } = await claimer.agent.post<ClaimResponse>(`/api/services/${placeId}/claim`);
    const self = await claimer.agent.post(`/api/admin/claims/${body.claim.id}/approve`);
    assert.equal(self.status, 403);
    const reject = await admin.agent.post(`/api/admin/claims/${body.claim.id}/reject`);
    assert.equal(reject.status, 200);
    // A rejected claim frees the member to try again.
    const retry = await claimer.agent.post<ClaimResponse>(`/api/services/${placeId}/claim`);
    assert.equal(retry.status, 201);
  });

  test('hidden service is 404 for members and visible to admins', async () => {
    const owner = await signUp(app.agent());
    const admin = await asAdmin(app);
    const { body: created } = await owner.agent.post<ServiceCreated>('/api/services', { ...SERVICE, name: 'Hidden Oven' });
    await app.db.query('UPDATE listings SET hidden = true WHERE id = $1', [created.id]);
    assert.equal((await app.agent().get(`/api/services/${created.slug}`)).status, 404);
    assert.equal((await admin.agent.get(`/api/services/${created.slug}`)).status, 200);
  });
});
