import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../../server/app.js';
import { fsMediaStore, retryMediaDeletions } from '../../server/lib/media.js';
import { Agent, TEST_ORIGIN, TEST_SECRET, asAdmin, makeTestApp, signUp, type TestApp } from '../helpers.js';

let app: TestApp;
before(async () => { app = await makeTestApp(); });
after(async () => { await app.close(); });

async function listing(owner: string, name: string) {
  return app.db.one<{ id: string; slug: string }>(`INSERT INTO listings (kind,name,slug,vegan_status,created_by) VALUES ('service',$2,$2,'fully_vegan',$1) RETURNING id,slug`, [owner, name]);
}

test('DATA-03 old slugs follow repeated merges and merged listings cannot be restored or merged again', async () => {
  const admin = await asAdmin(app);
  const a = await listing(admin.user.id, 'merge-a');
  const b = await listing(admin.user.id, 'merge-b');
  const c = await listing(admin.user.id, 'merge-c');
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: b.id, loserId: a.id })).status, 200);
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: c.id, loserId: b.id })).status, 200);
  const old = await app.agent().get<{ listing: { id: string } }>(`/api/listings/${a.slug}`);
  assert.equal(old.status, 200);
  assert.equal(old.body.listing.id, c.id);
  assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: a.id, action: 'restore' })).status, 409);
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: a.id, loserId: c.id })).status, 409);
});

test('DATA-03 merging reconciles conflicting owners and pending claims', async () => {
  const admin = await asAdmin(app);
  const owner = await signUp(app.agent());
  const former = await signUp(app.agent());
  const claimant = await signUp(app.agent());
  const a = await listing(owner.user.id, 'owned-survivor');
  const b = await listing(former.user.id, 'owned-loser');
  await app.db.query('UPDATE listings SET owner_user_id = created_by WHERE id = ANY($1::uuid[])', [[a.id, b.id]]);
  await app.db.query('UPDATE users SET has_service = true WHERE id = ANY($1::uuid[])', [[owner.user.id, former.user.id]]);
  await app.db.query(`INSERT INTO claims (listing_id,user_id,code,status) VALUES ($1,$2,'VW-1111','approved'),($3,$4,'VW-2222','approved'),($3,$5,'VW-3333','pending')`, [a.id, owner.user.id, b.id, former.user.id, claimant.user.id]);
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: a.id, loserId: b.id })).status, 200);
  const claims = await admin.agent.get<{ claims: { status: string; claimant: { id: string }; listing: { id: string } }[] }>('/api/admin/claims?status=all');
  assert.equal(claims.body.claims.find(c => c.claimant.id === former.user.id)?.status, 'revoked');
  assert.equal(claims.body.claims.find(c => c.claimant.id === claimant.user.id)?.status, 'rejected');
  assert.equal((await former.agent.get<{ user: { hasService: boolean } }>('/api/me')).body.user.hasService, false);
});

test('SEC-03 failed byte deletion remains visible, suppresses photo URLs, and retries on later admin activity', async () => {
  const local = await makeTestApp({ media: store => ({ ...store, del: async () => { throw new Error('synthetic storage failure'); } }) });
  try {
    const admin = await asAdmin(local);
    const stored = await fsMediaStore(local.mediaDir).put('synthetic.jpg', Buffer.from('synthetic bytes'), 'image/jpeg');
    const file = join(local.mediaDir, stored.pathname);
    const photo = await local.db.one<{ id: string }>(`INSERT INTO photos (user_id,blob_path,width,height) VALUES ($1,$2,1,1) RETURNING id`, [admin.user.id, stored.pathname]);
    const l = await local.db.one<{ slug: string }>(`INSERT INTO listings (kind,name,slug,vegan_status,created_by,photo_id) VALUES ('service','Storage fixture','storage-fixture','fully_vegan',$1,$2) RETURNING slug`, [admin.user.id, photo.id]);
    await local.db.query('UPDATE users SET avatar_photo_id = $1 WHERE id = $2', [photo.id, admin.user.id]);
    await local.db.query(`INSERT INTO recommendations (listing_id,user_id,body,photo_id) SELECT id,$1,'Storage fixture recommendation',$2 FROM listings WHERE slug=$3`, [admin.user.id, photo.id, l.slug]);
    assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: photo.id, action: 'hide' })).status, 200);
    const pending = await admin.agent.get<{ items: { targetId: string; preview: { path: string | null }; deletion: { pending: boolean; attempts: number } }[] }>('/api/admin/hidden?section=photos');
    const item = pending.body.items.find(x => x.targetId === photo.id);
    assert.ok(item);
    assert.equal(item.preview.path, null);
    assert.equal(item.deletion.pending, true);
    assert.ok(item.deletion.attempts > 0);
    assert.equal(existsSync(file), true);
    for (const url of [`/api/listings/${l.slug}`, `/api/services/${l.slug}`, '/api/feed', '/api/search?q=storage', '/api/admin/reports']) {
      const response = await admin.agent.get(url);
      assert.equal(response.status, 200, url);
      assert.ok(!JSON.stringify(response.body).includes(`/media/${stored.pathname}`), url);
    }
    // A fresh application instance only knows the durable database work.
    const restarted = createServer(createApp({ mailer: local.mailer, db: local.db, serverSecret: TEST_SECRET, appOrigin: TEST_ORIGIN, media: fsMediaStore(local.mediaDir) }));
    try {
      await new Promise<void>(resolve => restarted.listen(0, '127.0.0.1', resolve));
      const address = restarted.address();
      assert.ok(address && typeof address !== 'string');
      const agent = new Agent(`http://127.0.0.1:${address.port}`);
      for (const [name, value] of admin.agent.cookies) agent.cookies.set(name, value);
      await local.db.query("UPDATE media_deletions SET attempted_at = now() - interval '31 seconds' WHERE photo_id=$1", [photo.id]);
      await agent.get('/api/admin/hidden?section=photos');
      await retryMediaDeletions(local.db, fsMediaStore(local.mediaDir));
      const retried = await agent.get<typeof pending.body>('/api/admin/hidden?section=photos');
      assert.equal(retried.body.items.find(x => x.targetId === photo.id)?.deletion.pending, false);
      assert.equal(existsSync(file), false);
      const complete = await agent.get<typeof pending.body>('/api/admin/hidden?section=photos');
      assert.equal(complete.status, 200);
      assert.equal(complete.body.items.find(x => x.targetId === photo.id)?.deletion.pending, false);
    } finally {
      restarted.closeAllConnections();
      await new Promise<void>(resolve => restarted.close(() => resolve()));
    }
  } finally { await local.close(); }
});

test('DATA-02 queues reach all tied rows, prioritize auto hidden reports before limiting and separate photo history', async () => {
  const local = await makeTestApp();
  try {
    const admin = await asAdmin(local);
    const topics = await local.db.query<{ id: string }>(`INSERT INTO topics (user_id,kind,title,hidden,created_at) SELECT $1,'discussion','Queue ' || n,true,'2026-01-01' FROM generate_series(1,205) n RETURNING id`, [admin.user.id]);
    await local.db.query(`INSERT INTO photos (user_id,blob_path,width,height,deleted_at) SELECT $1,'queue-' || n || '.jpg',1,1,now() FROM generate_series(1,201) n`, [admin.user.id]);
    await local.db.query(`INSERT INTO reports (target_type,target_id,user_id,reason,created_at) SELECT 'topic',id,$1,'spam','2026-01-01' FROM topics`, [admin.user.id]);
    await local.db.query(`UPDATE reports SET created_at = '2025-01-01' WHERE target_id=$1`, [topics[0].id]);
    await local.db.query(`INSERT INTO audit (action,target_type,target_id) VALUES ('report.auto_hide','topic',$1)`, [topics[0].id]);
    const first = await admin.agent.get<{ groups: { targetId: string }[]; next: string | null }>('/api/admin/reports');
    assert.equal(first.body.groups[0].targetId, topics[0].id);
    assert.ok(first.body.next);
    const seen = new Set<string>();
    let next: string | null = null;
    do {
      const page: { body: { items: { targetId: string; targetType: string }[]; next: string | null } } = await admin.agent.get('/api/admin/hidden' + (next ? `?cursor=${encodeURIComponent(next)}` : ''));
      for (const item of page.body.items) { assert.notEqual(item.targetType, 'photo'); assert.ok(!seen.has(item.targetId)); seen.add(item.targetId); }
      next = page.body.next;
    } while (next);
    assert.equal(seen.size, 205);
    const users = await local.db.query<{ id: string }>(`INSERT INTO users (email_hmac,pw_hash,recovery_hash,pseudonym,banned_at) SELECT 'queue-'||n,'unused','unused','Queue member '||n,'2026-01-01' FROM generate_series(1,205) n RETURNING id`);
    const l = await local.db.one<{ id: string }>(`INSERT INTO listings (kind,name,slug,vegan_status,created_by) VALUES ('service','Queue service','queue-service','fully_vegan',$1) RETURNING id`, [admin.user.id]);
    await local.db.query(`INSERT INTO claims (listing_id,user_id,code) SELECT $1,id,'VW-'||(1000 + row_number() OVER ()) FROM users WHERE id = ANY($2::uuid[])`, [l.id, users.map(u => u.id)]);
    for (const [url, key] of [['/api/admin/reports', 'groups'], ['/api/admin/claims', 'claims'], ['/api/admin/hidden?section=banned', 'banned'], ['/api/admin/hidden?section=photos', 'items']] as const) {
      let cursor: string | null = null;
      const ids: string[] = [];
      do {
        const response: { body: Record<typeof key, { id?: string; targetId?: string }[]> & { next: string | null } } = await admin.agent.get(url + (cursor ? `${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : ''));
        ids.push(...response.body[key].map(x => x.id ?? x.targetId ?? 'missing'));
        cursor = response.body.next;
      } while (cursor);
      assert.equal(ids.length, key === 'items' ? 201 : 205, url);
      assert.equal(new Set(ids).size, ids.length, url);
    }
  } finally { await local.close(); }
});

test('PERF-02 queue query counts stay bounded as the page fills', async () => {
  const sql: string[] = [];
  const local = await makeTestApp({ sqlLog: sql });
  try {
    const admin = await asAdmin(local);
    const add = async (n: number) => {
      await local.db.query(`INSERT INTO topics (user_id,kind,title,hidden) SELECT $1,'discussion','Batch '||n,true FROM generate_series(1,$2::int) n`, [admin.user.id, n]);
      await local.db.query(`INSERT INTO reports (target_type,target_id,user_id,reason) SELECT 'topic',id,$1,'spam' FROM topics ON CONFLICT DO NOTHING`, [admin.user.id]);
    };
    const count = async (url: string) => { sql.length = 0; assert.equal((await admin.agent.get(url)).status, 200); return sql.length; };
    await add(1);
    const hidden = await count('/api/admin/hidden');
    const reports = await count('/api/admin/reports');
    await add(20);
    assert.ok(await count('/api/admin/hidden') <= hidden + 1);
    assert.ok(await count('/api/admin/reports') <= reports + 1);
  } finally { await local.close(); }
});

test('DATA-03 an unowned survivor inherits the owner and approved claim of its duplicate', async () => {
  const admin = await asAdmin(app);
  const owner = await signUp(app.agent());
  const a = await listing(admin.user.id, 'inherit-survivor');
  const b = await listing(owner.user.id, 'inherit-loser');
  await app.db.query(`UPDATE listings SET owner_user_id=$2,contact='{"website":"https://synthetic.example"}' WHERE id=$1`, [b.id, owner.user.id]);
  await app.db.query(`INSERT INTO claims (listing_id,user_id,code,status) VALUES ($1,$2,'VW-4444','approved')`, [b.id, owner.user.id]);
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: a.id, loserId: b.id })).status, 200);
  const claims = await admin.agent.get<{ claims: { code: string; status: string; listing: { id: string } }[] }>('/api/admin/claims?status=all');
  const claim = claims.body.claims.find(c => c.code === 'VW-4444');
  assert.equal(claim?.listing.id, a.id);
  assert.equal(claim?.status, 'approved');
  const service = await owner.agent.get<{ contact: { website: string } }>(`/api/services/${a.slug}`);
  assert.equal(service.status, 200);
  assert.equal(service.body.contact.website, 'https://synthetic.example');
});

test('DATA-03 merging unowned listings preserves one pending claim per claimant on the survivor', async () => {
  const admin = await asAdmin(app);
  const a = await listing(admin.user.id, 'pending-survivor');
  const b = await listing(admin.user.id, 'pending-loser');
  const first = await signUp(app.agent());
  const second = await signUp(app.agent());
  await app.db.query(`INSERT INTO claims (listing_id,user_id,code) VALUES ($1,$3,'VW-5555'),($2,$3,'VW-5556'),($2,$4,'VW-5557')`, [a.id, b.id, first.user.id, second.user.id]);
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: a.id, loserId: b.id })).status, 200);
  const claims = await admin.agent.get<{ claims: { code: string; status: string; listing: { id: string } }[] }>('/api/admin/claims?status=all');
  for (const code of ['VW-5555', 'VW-5557']) {
    const claim = claims.body.claims.find(c => c.code === code);
    assert.equal(claim?.status, 'pending');
    assert.equal(claim?.listing.id, a.id);
  }
  assert.equal(claims.body.claims.find(c => c.code === 'VW-5556')?.status, 'rejected');
});

test('review 7: service endpoint resolves old slugs through repeated merges', async () => {
  const admin = await asAdmin(app);
  const a = await listing(admin.user.id, 'service-chain-a');
  const b = await listing(admin.user.id, 'service-chain-b');
  const c = await listing(admin.user.id, 'service-chain-c');
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: b.id, loserId: a.id })).status, 200);
  assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: c.id, loserId: b.id })).status, 200);
  for (const slug of [a.slug, b.slug]) {
    const response = await app.agent().get<{ id: string; slug: string }>(`/api/services/${slug}`);
    assert.equal(response.status, 200, slug);
    assert.equal(response.body.id, c.id);
    assert.equal(response.body.slug, c.slug);
  }
  await app.db.query('UPDATE listings SET hidden=true WHERE id=$1', [c.id]);
  assert.equal((await app.agent().get(`/api/services/${a.slug}`)).status, 404);
  assert.equal((await admin.agent.get(`/api/services/${a.slug}`)).status, 200);
});
