import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fsMediaStore, retryMediaDeletions } from '../../server/lib/media.js';
import { asAdmin, makeTestApp, signUp, type TestApp } from '../helpers.js';

async function photo(app: TestApp, userId: string, name: string) {
  const { pathname } = await fsMediaStore(app.mediaDir).put(`${name}.jpg`, Buffer.from('synthetic bytes'), 'image/jpeg');
  const row = await app.db.one<{ id: string }>('INSERT INTO photos (user_id,blob_path,width,height) VALUES ($1,$2,1,1) RETURNING id', [userId, pathname]);
  return { id: row.id, pathname, file: join(app.mediaDir, pathname) };
}

for (const action of ['hide', 'ban', 'delete account'] as const) {
  test(`review 4: ${action} deletes its own bytes and completes work despite a retry backlog`, async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const member = await signUp(app.agent());
      await app.db.query(`INSERT INTO photos (user_id,blob_path,width,height,deleted_at,created_at)
        SELECT $1,'old-'||n||'.jpg',1,1,now(),'2025-01-01' FROM generate_series(1,35) n`, [admin.user.id]);
      const target = await photo(app, member.user.id, 'new-target');
      const response = action === 'hide'
        ? await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: target.id, action: 'hide' })
        : action === 'ban' ? await admin.agent.post(`/api/admin/users/${member.user.id}/ban`)
          : await member.agent.post('/api/me/delete', { password: member.password });
      assert.equal(response.status, 200);
      assert.equal(existsSync(target.file), false, 'selected bytes are removed before the response');
      const work = await app.db.one<{ completed_at: Date | null }>('SELECT completed_at FROM media_deletions WHERE photo_id=$1', [target.id]);
      assert.ok(work.completed_at, 'successful direct deletion is complete');
    } finally { await app.close(); }
  });
}

test('review 5: a blocked retry cannot hold an admin response or an open transaction', { timeout: 10000 }, async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reached = new Promise<void>(resolve => { started = resolve; });
  const app = await makeTestApp({ media: store => ({ ...store, del: async (path) => { started(); await gate; await store.del(path); } }) });
  try {
    const admin = await asAdmin(app);
    await app.db.query(`INSERT INTO photos (user_id,blob_path,width,height,deleted_at) VALUES ($1,'retry.jpg',1,1,now())`, [admin.user.id]);
    const response = admin.agent.get('/api/admin/hidden');
    await reached;
    let timer: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      response,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 300); }),
    ]);
    clearTimeout(timer!);
    assert.ok(result, 'admin response must finish while storage is blocked');
    assert.equal(result.status, 200);
    const independent = app.db.tx(q => q.one<{ n: number }>('SELECT 1 AS n'));
    const row = await Promise.race([
      independent,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 300); }),
    ]);
    clearTimeout(timer!);
    assert.equal(row?.n, 1, 'retry must not keep a DB transaction open');
  } finally { release(); await retryMediaDeletions(app.db, fsMediaStore(app.mediaDir)); await app.close(); }
});


test('review 5: retry errors do not fail admin requests and each batch is bounded', async () => {
  let attempts = 0;
  const app = await makeTestApp({ media: store => ({ ...store, del: async () => { attempts++; throw new Error('synthetic failure'); } }) });
  try {
    const admin = await asAdmin(app);
    await app.db.query(`INSERT INTO photos (user_id,blob_path,width,height,deleted_at)
      SELECT $1,'failed-'||n||'.jpg',1,1,now() FROM generate_series(1,12) n`, [admin.user.id]);
    assert.equal((await admin.agent.get('/api/admin/reports')).status, 200);
    await retryMediaDeletions(app.db, fsMediaStore(app.mediaDir));
    assert.equal(attempts, 10);
    const query = app.db.query.bind(app.db);
    app.db.query = (sql, params) => {
      if (sql.includes('WITH pending AS')) return Promise.reject(new Error('synthetic DB failure'));
      return query(sql, params);
    };
    assert.equal((await admin.agent.get('/api/admin/reports')).status, 200);
    await retryMediaDeletions(app.db, fsMediaStore(app.mediaDir));
  } finally { await app.close(); }
});

for (const decision of ['restore', 'dismiss'] as const) {
  test(`review 6: reported photos keep bytes, suppress every photo projection and allow ${decision}`, async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const member = await signUp(app.agent());
      const target = await photo(app, member.user.id, 'photos/auto-hidden');
      const listing = await app.db.one<{ id: string; slug: string }>(`INSERT INTO listings
        (kind,name,slug,vegan_status,created_by,photo_id) VALUES ('service','Synthetic photo cafe','synthetic-photo-cafe','fully_vegan',$1,$2) RETURNING id,slug`, [member.user.id, target.id]);
      await app.db.query('UPDATE users SET avatar_photo_id=$1 WHERE id=$2', [target.id, member.user.id]);
      await app.db.query(`INSERT INTO recommendations (listing_id,user_id,body,photo_id) VALUES ($1,$2,'Synthetic photo recommendation',$3)`, [listing.id, member.user.id, target.id]);
      for (let i = 0; i < 3; i++) {
        const reporter = await signUp(app.agent());
        await app.db.query("UPDATE users SET created_at=now()-interval '4 days' WHERE id=$1", [reporter.user.id]);
        const reported = await reporter.agent.post<{ hidden: boolean }>('/api/reports', { targetType: 'photo', targetId: target.id, reason: 'spam' });
        assert.equal(reported.status, 201);
        assert.equal(reported.body.hidden, i === 2);
      }
      assert.equal(existsSync(target.file), true, 'auto hide retains bytes for an admin decision');
      for (const url of [`/api/listings/${listing.slug}`, `/api/services/${listing.slug}`, `/api/listings/${listing.slug}/recommendations`, '/api/feed', '/api/search?q=synthetic', '/api/me/profile', '/api/admin/hidden?section=photos']) {
        const response = await (url === '/api/me/profile' ? member.agent : admin.agent).get(url);
        assert.equal(response.status, 200, url);
        assert.ok(!JSON.stringify(response.body).includes(`/media/${target.pathname}`), url);
      }
      assert.equal((await member.agent.get(`/api/reports/photo-target?url=${encodeURIComponent(`/media/${target.pathname}`)}`)).status, 404);
      const hidden = await admin.agent.get<{ items: { targetId: string; restorable: boolean }[] }>('/api/admin/hidden?section=photos');
      assert.equal(hidden.body.items.find(item => item.targetId === target.id)?.restorable, true);
      assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: target.id, action: decision })).status, 200);
      const visible = await member.agent.get(`/api/listings/${listing.slug}`);
      assert.ok(JSON.stringify(visible.body).includes(`/media/${target.pathname}`));
      assert.equal(existsSync(target.file), true);
      assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: target.id, action: 'hide' })).status, 200);
      assert.equal(existsSync(target.file), false);
      assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: target.id, action: 'restore' })).status, 409);
    } finally { await app.close(); }
  });
}

test('review 6: a listing owner cannot auto hide photos on recommendations about their listing', async () => {
  const app = await makeTestApp();
  try {
    const owner = await signUp(app.agent());
    const author = await signUp(app.agent());
    const target = await photo(app, author.user.id, 'photos/owner-exempt');
    const listing = await app.db.one<{ id: string }>(`INSERT INTO listings (kind,name,slug,vegan_status,created_by,owner_user_id)
      VALUES ('service','Synthetic owner cafe','synthetic-owner-cafe','fully_vegan',$1,$1) RETURNING id`, [owner.user.id]);
    await app.db.query(`INSERT INTO recommendations (listing_id,user_id,body,photo_id) VALUES ($1,$2,'Synthetic review photo',$3)`, [listing.id, author.user.id, target.id]);
    const reporters = [owner, await signUp(app.agent()), await signUp(app.agent())];
    for (const reporter of reporters) {
      await app.db.query("UPDATE users SET created_at=now()-interval '4 days' WHERE id=$1", [reporter.user.id]);
      const reported = await reporter.agent.post<{ hidden: boolean }>('/api/reports', { targetType: 'photo', targetId: target.id, reason: 'spam' });
      assert.equal(reported.status, 201);
      assert.equal(reported.body.hidden, false, 'an owner report requires an admin decision');
    }
    assert.equal(existsSync(target.file), true);
    const visible = await author.agent.get(`/api/listings/synthetic-owner-cafe/recommendations`);
    assert.ok(JSON.stringify(visible.body).includes(`/media/${target.pathname}`));
  } finally { await app.close(); }
});
