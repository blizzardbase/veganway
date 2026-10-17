import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { asAdmin, backdateUser, makeTestApp, signUp, type SignedUp, type TestApp } from '../helpers.js';
import type { MergeResult, ReportQueue } from '../../shared/types/admin.js';

async function insertListing(app: TestApp, createdBy: string, name: string, kind: 'place' | 'product' | 'service' = 'place'): Promise<string> {
  const row = await app.db.one<{ id: string }>(
    `INSERT INTO listings (kind, name, slug, area, vegan_status, summary, created_by)
     VALUES ($1, $2, $3, 'JLT', $4, '', $5) RETURNING id`,
    [kind, name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`, kind === 'product' ? 'vegan_product' : 'fully_vegan', createdBy],
  );
  return row.id;
}

async function aged(app: TestApp, n: number): Promise<SignedUp[]> {
  const out: SignedUp[] = [];
  for (let i = 0; i < n; i++) {
    const m = await signUp(app.agent());
    await backdateUser(app.db, m.user.id, 96);
    out.push(m);
  }
  return out;
}

describe('reports', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('three reports from accounts older than 24 hours hide the target and write audit', async () => {
    const author = await signUp(app.agent());
    const listingId = await insertListing(app, author.user.id, 'Spammy Place');
    const reporters = await aged(app, 3);
    for (const [i, r] of reporters.entries()) {
      const res = await r.agent.post<{ hidden: boolean }>('/api/reports', { targetType: 'listing', targetId: listingId, reason: 'spam' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.hidden, i === 2);
    }
    const row = await app.db.one<{ hidden: boolean }>('SELECT hidden FROM listings WHERE id = $1', [listingId]);
    assert.equal(row.hidden, true);
    assert.ok(await app.db.maybeOne(`SELECT 1 FROM audit WHERE action = 'report.auto_hide' AND target_id = $1`, [listingId]));
  });

  test('three reports from fresh accounts do not hide the target', async () => {
    const author = await signUp(app.agent());
    const rec = await app.db.one<{ id: string }>(
      `INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, 'Try the lentil soup.') RETURNING id`,
      [await insertListing(app, author.user.id, 'Fresh Place'), author.user.id],
    );
    for (let i = 0; i < 3; i++) {
      const fresh = await signUp(app.agent());
      const res = await fresh.agent.post('/api/reports', { target_type: 'recommendation', target_id: rec.id, reason: 'offensive' });
      assert.equal(res.status, 201);
    }
    const row = await app.db.one<{ hidden: boolean }>('SELECT hidden FROM recommendations WHERE id = $1', [rec.id]);
    assert.equal(row.hidden, false);
  });

  test('one open report per member per target; unknown target 404; signed out 401', async () => {
    const author = await signUp(app.agent());
    const reporter = await signUp(app.agent());
    const id = await insertListing(app, author.user.id, 'Twice Reported');
    assert.equal((await reporter.agent.post('/api/reports', { targetType: 'listing', targetId: id, reason: 'wrong_info' })).status, 201);
    const twice = await reporter.agent.post('/api/reports', { targetType: 'listing', targetId: id, reason: 'spam' });
    assert.equal(twice.status, 409);
    const missing = await reporter.agent.post('/api/reports', { targetType: 'topic', targetId: '00000000-0000-4000-8000-00000000abcd', reason: 'spam' });
    assert.equal(missing.status, 404);
    const badReason = await reporter.agent.post('/api/reports', { targetType: 'listing', targetId: id, reason: 'boring' });
    assert.equal(badReason.status, 400);
    assert.equal((await app.agent().post('/api/reports', { targetType: 'listing', targetId: id, reason: 'spam' })).status, 401);
    // After an admin dismisses, the member may report again.
    const admin = await asAdmin(app);
    assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: id, action: 'dismiss' })).status, 200);
    assert.equal((await reporter.agent.post('/api/reports', { targetType: 'listing', targetId: id, reason: 'spam' })).status, 201);
  });

  test('admins see all reports; members do not', async () => {
    const admin = await asAdmin(app);
    const member = await signUp(app.agent());
    const list = await admin.agent.get<{ reports: unknown[] }>('/api/reports');
    assert.equal(list.status, 200);
    assert.ok(list.body.reports.length >= 3);
    assert.equal((await member.agent.get('/api/reports')).status, 403);
  });
});

describe('admin', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('queue groups reports by target with counts and a preview; hide and restore work and are audited', async () => {
    const admin = await asAdmin(app);
    const author = await signUp(app.agent());
    const topic = await app.db.one<{ id: string }>(
      `INSERT INTO topics (user_id, kind, title, body) VALUES ($1, 'discussion', 'Best tofu in town?', 'Asking for a friend.') RETURNING id`,
      [author.user.id],
    );
    for (const reason of ['spam', 'spam', 'offensive']) {
      const r = await signUp(app.agent());
      await r.agent.post('/api/reports', { targetType: 'topic', targetId: topic.id, reason });
    }
    const queue = await admin.agent.get<ReportQueue>('/api/admin/reports');
    assert.equal(queue.status, 200);
    const group = queue.body.groups.find((g) => g.targetId === topic.id);
    assert.ok(group);
    assert.equal(group.openCount, 3);
    assert.deepEqual(group.reasons.find((x) => x.reason === 'spam')?.count, 2);
    assert.equal(group.preview.title, 'Best tofu in town?');
    assert.equal(group.preview.author, author.user.pseudonym);

    assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'topic', targetId: topic.id, action: 'hide' })).status, 200);
    assert.equal((await app.db.one<{ hidden: boolean }>('SELECT hidden FROM topics WHERE id = $1', [topic.id])).hidden, true);
    const after = await admin.agent.get<ReportQueue>('/api/admin/reports');
    assert.equal(after.body.groups.some((g) => g.targetId === topic.id), false);
    assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'topic', targetId: topic.id, action: 'restore' })).status, 200);
    assert.equal((await app.db.one<{ hidden: boolean }>('SELECT hidden FROM topics WHERE id = $1', [topic.id])).hidden, false);
    const actions = await app.db.query<{ action: string }>('SELECT action FROM audit WHERE target_id = $1 ORDER BY created_at', [topic.id]);
    assert.deepEqual(actions.map((a) => a.action), ['moderation.hide', 'moderation.restore']);
  });

  test('a reported reply is titled by what it replies to, not by its type', async () => {
    const admin = await asAdmin(app);
    const author = await signUp(app.agent());
    const topic = await app.db.one<{ id: string }>(
      `INSERT INTO topics (user_id, kind, title, body) VALUES ($1, 'discussion', 'Oat milk that foams?', 'Asking.') RETURNING id`,
      [author.user.id],
    );
    const placeId = await insertListing(app, author.user.id, 'Reply Target Kitchen');
    const onTopic = await app.db.one<{ id: string }>(`INSERT INTO replies (target_type, target_id, user_id, body) VALUES ('topic', $1, $2, 'Try the barista one.') RETURNING id`, [topic.id, author.user.id]);
    const onPlace = await app.db.one<{ id: string }>(`INSERT INTO replies (target_type, target_id, user_id, body) VALUES ('listing', $1, $2, 'Open late?') RETURNING id`, [placeId, author.user.id]);
    const reporter = await signUp(app.agent());
    for (const id of [onTopic.id, onPlace.id]) {
      assert.equal((await reporter.agent.post('/api/reports', { targetType: 'reply', targetId: id, reason: 'spam' })).status, 201);
    }
    const queue = await admin.agent.get<ReportQueue>('/api/admin/reports');
    assert.equal(queue.body.groups.find((g) => g.targetId === onTopic.id)?.preview.title, 'Reply on Oat milk that foams?');
    assert.equal(queue.body.groups.find((g) => g.targetId === onPlace.id)?.preview.title, 'Reply on Reply Target Kitchen');
  });

  test('ban kills sessions, blocks login and hides content', async () => {
    const admin = await asAdmin(app);
    const spammer = await signUp(app.agent());
    const friend = await signUp(app.agent());
    const spamOnly = await insertListing(app, spammer.user.id, 'Buy Now Deals');
    const realPlace = await insertListing(app, spammer.user.id, 'Real Vegan Diner');
    await app.db.query(`INSERT INTO opinions (listing_id, user_id, value) VALUES ($1, $2, 'recommend')`, [realPlace, friend.user.id]);
    const rec = await app.db.one<{ id: string }>(`INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, 'spam spam') RETURNING id`, [realPlace, spammer.user.id]);
    const reply = await app.db.one<{ id: string }>(`INSERT INTO replies (target_type, target_id, user_id, body) VALUES ('listing', $1, $2, 'more spam') RETURNING id`, [realPlace, spammer.user.id]);
    const topic = await app.db.one<{ id: string }>(`INSERT INTO topics (user_id, kind, title) VALUES ($1, 'discussion', 'Spam topic') RETURNING id`, [spammer.user.id]);

    assert.equal((await spammer.agent.get<{ user: unknown }>('/api/me')).body.user !== null, true);
    const ban = await admin.agent.post(`/api/admin/users/${spammer.user.id}/ban`);
    assert.equal(ban.status, 200, JSON.stringify(ban.body));

    const sessions = await app.db.one<{ n: number }>('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [spammer.user.id]);
    assert.equal(sessions.n, 0);
    assert.equal((await spammer.agent.get<{ user: unknown }>('/api/me')).body.user, null);
    const login = await app.agent().post('/api/auth/login', { email: spammer.email, password: spammer.password });
    assert.equal(login.status, 403);

    const hidden = async (table: string, id: string) => (await app.db.one<{ hidden: boolean }>(`SELECT hidden FROM ${table} WHERE id = $1`, [id])).hidden;
    assert.equal(await hidden('recommendations', rec.id), true);
    assert.equal(await hidden('replies', reply.id), true);
    assert.equal(await hidden('topics', topic.id), true);
    assert.equal(await hidden('listings', spamOnly), true);
    // A place another member rated stays: it is real, whoever added it.
    assert.equal(await hidden('listings', realPlace), false);
    assert.ok(await app.db.maybeOne(`SELECT 1 FROM audit WHERE action = 'user.ban' AND target_id = $1`, [spammer.user.id]));

    // Admins cannot be banned by mistake.
    assert.equal((await admin.agent.post(`/api/admin/users/${admin.user.id}/ban`)).status, 400);
  });

  test('merge moves recommendations, bookmarks, replies and topic links, without duplicating opinions', async () => {
    const admin = await asAdmin(app);
    const a = await signUp(app.agent());
    const b = await signUp(app.agent());
    const survivor = await insertListing(app, a.user.id, 'Leafy Bowl');
    const loser = await insertListing(app, b.user.id, 'Leafy Bowls');
    await app.db.query(`INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, 'Get the poke bowl.'), ($1, $3, 'Great smoothies.')`, [loser, a.user.id, b.user.id]);
    // a rated both; b rated only the loser.
    await app.db.query(`INSERT INTO opinions (listing_id, user_id, value) VALUES ($1, $3, 'recommend'), ($2, $3, 'not_for_me'), ($2, $4, 'recommend')`, [survivor, loser, a.user.id, b.user.id]);
    await app.db.query(`INSERT INTO bookmarks (user_id, listing_id) VALUES ($1, $2), ($1, $3)`, [a.user.id, survivor, loser]);
    await app.db.query(`INSERT INTO replies (target_type, target_id, user_id, body) VALUES ('listing', $1, $2, 'Open late?')`, [loser, b.user.id]);
    const topic = await app.db.one<{ id: string }>(
      `INSERT INTO topics (user_id, kind, title, listing_ids) VALUES ($1, 'discussion', 'Bowls compared', ARRAY[$2::uuid, $3::uuid]) RETURNING id`,
      [a.user.id, survivor, loser],
    );

    const res = await admin.agent.post<MergeResult>('/api/admin/listings/merge', { survivorId: survivor, loserId: loser });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.moved.recommendations, 2);

    const recs = await app.db.one<{ n: number }>('SELECT count(*) AS n FROM recommendations WHERE listing_id = $1', [survivor]);
    assert.equal(recs.n, 2);
    const ops = await app.db.query<{ user_id: string; value: string }>('SELECT user_id, value FROM opinions WHERE listing_id = $1 ORDER BY value', [survivor]);
    assert.equal(ops.length, 2, 'one opinion per member');
    assert.equal(ops.find((o) => o.user_id === a.user.id)?.value, 'recommend', 'the survivor opinion wins');
    assert.equal((await app.db.one<{ n: number }>('SELECT count(*) AS n FROM opinions WHERE listing_id = $1', [loser])).n, 0);
    assert.equal((await app.db.one<{ n: number }>('SELECT count(*) AS n FROM bookmarks WHERE user_id = $1', [a.user.id])).n, 1);
    assert.equal((await app.db.one<{ n: number }>(`SELECT count(*) AS n FROM replies WHERE target_type = 'listing' AND target_id = $1`, [survivor])).n, 1);
    const t = await app.db.one<{ listing_ids: string[] }>('SELECT listing_ids FROM topics WHERE id = $1', [topic.id]);
    assert.deepEqual(t.listing_ids, [survivor]);
    assert.equal((await app.db.one<{ hidden: boolean }>('SELECT hidden FROM listings WHERE id = $1', [loser])).hidden, true);
    assert.ok(await app.db.maybeOne(`SELECT 1 FROM audit WHERE action = 'listing.merge' AND target_id = $1`, [survivor]));

    const product = await insertListing(app, a.user.id, 'Oat Milk', 'product');
    assert.equal((await admin.agent.post('/api/admin/listings/merge', { survivorId: survivor, loserId: product })).status, 400);
  });

  test('listing search includes hidden listings, and the audit log names the acting admin', async () => {
    const admin = await asAdmin(app);
    const hiddenId = await insertListing(app, admin.user.id, 'Leafy Hidden');
    await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: hiddenId, action: 'hide' });
    const found = await admin.agent.get<{ listings: { name: string }[] }>('/api/admin/listings?q=leafy');
    assert.ok(found.body.listings.some((l) => l.name === 'Leafy Hidden'), 'hidden listings appear for admins');
    assert.ok(!found.body.listings.some((l) => l.name === 'Leafy Bowls'), 'merged listings cannot be selected again');
    const id = await insertListing(app, admin.user.id, 'Audit Me');
    assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: id, action: 'hide' })).status, 200);
    const log = await admin.agent.get<{ rows: { action: string; actor: string | null; targetId: string | null }[] }>('/api/admin/audit');
    assert.equal(log.status, 200);
    assert.ok(log.body.rows.some((r) => r.action === 'moderation.hide' && r.actor === admin.user.pseudonym && r.targetId === id));
  });

  test('a non admin gets 403 on every admin route, and signed out gets 401', async () => {
    const member = await signUp(app.agent());
    const id = '00000000-0000-4000-8000-0000000000aa';
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/admin/reports'],
      ['POST', '/api/admin/moderate', { targetType: 'listing', targetId: id, action: 'hide' }],
      ['POST', `/api/admin/users/${id}/ban`],
      ['POST', `/api/admin/users/${id}/unban`],
      ['GET', '/api/admin/claims'],
      ['POST', `/api/admin/claims/${id}/approve`],
      ['POST', `/api/admin/claims/${id}/reject`],
      ['POST', `/api/admin/claims/${id}/revoke`],
      ['POST', `/api/admin/listings/${id}/revoke-owner`],
      ['GET', '/api/admin/listings?q=a'],
      ['POST', '/api/admin/listings/merge', { survivorId: id, loserId: id }],
      ['GET', '/api/admin/audit'],
      ['GET', '/api/reports'],
    ];
    for (const [method, path, body] of routes) {
      const res = await member.agent.request(method, path, body ?? (method === 'GET' ? undefined : {}));
      assert.equal(res.status, 403, `${method} ${path} as member`);
      const anon = await app.agent().request(method, path, body ?? (method === 'GET' ? undefined : {}));
      assert.equal(anon.status, 401, `${method} ${path} signed out`);
    }
  });
});
