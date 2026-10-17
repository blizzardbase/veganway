import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signUp, type TestApp, type SignedUp } from '../helpers.js';

describe('contextual photo reporting', () => {
  let app: TestApp;
  let member: SignedUp;
  let photoId: string;
  let listingId: string;
  before(async () => {
    app = await makeTestApp();
    member = await signUp(app.agent());
    const photo = await app.db.one<{ id: string }>(`INSERT INTO photos (user_id, blob_path, width, height)
      VALUES ($1, 'photos/synthetic-report.jpg', 2, 2) RETURNING id`, [member.user.id]);
    photoId = photo.id;
    const listing = await app.db.one<{ id: string }>(`INSERT INTO listings (kind, name, slug, area, vegan_status, created_by, photo_id)
      VALUES ('place', 'Synthetic photo report', 'synthetic-photo-report', 'JLT', 'fully_vegan', $1, $2) RETURNING id`, [member.user.id, photoId]);
    listingId = listing.id;
  });
  after(async () => { await app.close(); });

  test('UX-01: a displayed photo resolves to its real report target id', async () => {
    const target = await member.agent.get<{ id: string }>('/api/reports/photo-target?url=%2Fmedia%2Fphotos%2Fsynthetic-report.jpg');
    assert.equal(target.status, 200);
    assert.equal(target.body.id, photoId);
    const sent = await member.agent.post('/api/reports', { target_type: 'photo', target_id: target.body.id, reason: 'spam' });
    assert.equal(sent.status, 201);
  });

  test('UX-01: lookup requires an account and refuses unavailable or unreferenced photos', async () => {
    const url = '/api/reports/photo-target?url=%2Fmedia%2Fphotos%2Fsynthetic-report.jpg';
    assert.equal((await app.agent().get(url)).status, 401);
    assert.equal((await member.agent.get('/api/reports/photo-target?url=https%3A%2F%2Fevil.example%2Fimage.jpg')).status, 400);
    await app.db.query('UPDATE listings SET hidden = true WHERE id = $1', [listingId]);
    assert.equal((await member.agent.get(url)).status, 404);
    await app.db.query('UPDATE listings SET hidden = false, photo_id = NULL WHERE id = $1', [listingId]);
    assert.equal((await member.agent.get(url)).status, 404);
    await app.db.query(`INSERT INTO recommendations (listing_id, user_id, body, photo_id) VALUES ($1, $2, 'Synthetic photo recommendation', $3)`, [listingId, member.user.id, photoId]);
    assert.equal((await member.agent.get(url)).status, 200);
    await app.db.query('UPDATE recommendations SET hidden = true WHERE listing_id = $1', [listingId]);
    assert.equal((await member.agent.get(url)).status, 404);
    await app.db.query('UPDATE recommendations SET hidden = false WHERE listing_id = $1', [listingId]);
    await app.db.query('UPDATE photos SET deleted_at = now() WHERE id = $1', [photoId]);
    assert.equal((await member.agent.get(url)).status, 404);
  });
});
