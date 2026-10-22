// Fix round 1: regression tests for the security and adversarial review findings. One test or more per finding.
import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { asAdmin, backdateUser, makeTestApp, signUp, uniqueEmail, TEST_SECRET, type SignedUp, type TestApp } from '../helpers.js';
import { deriveKeys, ipKey } from '../../server/lib/crypto.js';
import { DEFAULT_LIMITS } from '../../server/lib/rate.js';
import { createDb } from '../../server/db.js';
import { createPgPool, PG_POOL_OPTIONS } from '../../server/db.js';
import { JPEG_MAX_SIDE } from '../../server/lib/jpeg.js';
import type { PhotoResponse } from '../../shared/types/listings.js';

const run = promisify(execFile);

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** A structurally valid JPEG of the given size. The server never decodes pixels. */
function makeJpeg(width = 640, height = 480): Buffer {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xdb, Buffer.alloc(65, 1)),
    segment(0xc0, sof),
    segment(0xc4, Buffer.alloc(20, 2)),
    segment(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    Buffer.alloc(32, 0x5a),
    Buffer.from([0xff, 0xd9]),
  ]);
}

async function upload(m: SignedUp, width = 640, height = 480) {
  return m.agent.post<PhotoResponse>('/api/photos', undefined, { raw: { body: makeJpeg(width, height), contentType: 'image/jpeg' } });
}

async function photoPath(app: TestApp, id: string): Promise<string> {
  const row = await app.db.one<{ blob_path: string }>('SELECT blob_path FROM photos WHERE id = $1', [id]);
  return join(app.mediaDir, row.blob_path);
}

async function place(m: SignedUp, name = 'Fix Round Cafe', extra: Record<string, unknown> = {}) {
  const res = await m.agent.post<{ listing: { id: string; slug: string } }>('/api/listings', { kind: 'place', name, veganStatus: 'fully_vegan', area: 'JLT', ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.listing;
}

/** n members whose accounts are old enough for their reports to count. */
async function veterans(app: TestApp, n: number, hours = 96): Promise<SignedUp[]> {
  const out: SignedUp[] = [];
  for (let i = 0; i < n; i++) {
    const m = await signUp(app.agent());
    await backdateUser(app.db, m.user.id, hours);
    out.push(m);
  }
  return out;
}

async function report(m: SignedUp, targetType: string, targetId: string) {
  const res = await m.agent.post<{ hidden: boolean }>('/api/reports', { targetType, targetId, reason: 'spam' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe('1. signup lockout', () => {
  test('301 taken email attempts from many IP keys do not block a fresh signup', async () => {
    const app = await makeTestApp({ trustProxy: true });
    try {
      const taken = uniqueEmail('taken');
      const first = await app.agent().post('/api/auth/signup', { email: taken, password: 'correct horse battery' }, { headers: { 'x-forwarded-for': '198.51.100.1' } });
      assert.equal(first.status, 201);
      for (let i = 0; i < 301; i++) {
        const ip = `10.${(i >> 8) & 255}.${i & 255}.7`;
        const res = await app.agent().post('/api/auth/signup', { email: taken, password: 'correct horse battery' }, { headers: { 'x-forwarded-for': ip } });
        assert.equal(res.status, 409, `attempt ${i} from ${ip}: ${res.status}`);
      }
      const fresh = await app.agent().post('/api/auth/signup', { email: uniqueEmail('fresh'), password: 'correct horse battery' }, { headers: { 'x-forwarded-for': '203.0.113.9' } });
      assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    } finally {
      await app.close();
    }
  });

  test('the global signup limit is 600 per hour and counts only accounts created', async () => {
    assert.equal(DEFAULT_LIMITS.signupGlobal.max, 600);
    assert.equal(DEFAULT_LIMITS.signupGlobal.windowSec, 3600);
    const app = await makeTestApp({ limits: { signupGlobal: { max: 2, windowSec: 3600 } } });
    try {
      await signUp(app.agent());
      await signUp(app.agent());
      const third = await app.agent().post('/api/auth/signup', { email: uniqueEmail(), password: 'correct horse battery' });
      assert.equal(third.status, 429);
      const { hits } = await app.db.one<{ hits: number }>(`SELECT hits FROM rate_limits WHERE key = 'signup:global'`);
      assert.equal(hits, 2, 'a refused signup is not counted');
    } finally {
      await app.close();
    }
  });

  test('IPv6 clients share one key per /64; IPv4 keys by the full address', () => {
    const keys = deriveKeys(TEST_SECRET);
    const day = new Date('2026-10-16T10:00:00Z');
    assert.equal(ipKey(keys, '2001:db8:1:2:aaaa:bbbb:cccc:dddd', day), ipKey(keys, '2001:db8:1:2::1', day));
    assert.equal(ipKey(keys, '2001:0db8:0001:0002::9', day), ipKey(keys, '2001:db8:1:2:ffff::', day));
    assert.notEqual(ipKey(keys, '2001:db8:1:2::1', day), ipKey(keys, '2001:db8:1:3::1', day));
    assert.notEqual(ipKey(keys, '192.0.2.1', day), ipKey(keys, '192.0.2.2', day));
    assert.equal(ipKey(keys, '::ffff:192.0.2.1', day), ipKey(keys, '192.0.2.1', day));
  });
});

describe('2. migrations on preview builds', () => {
  const script = join(process.cwd(), 'server/cli/vercel-migrate.ts');
  const migrateWith = async (env: Record<string, string>) => {
    const dir = join(mkdtempSync(join(tmpdir(), 'vw-vm-')), 'db');
    const out = await run(process.execPath, ['--import', 'tsx', script], { env: { ...process.env, ...env, DATABASE_URL: `pglite://${dir}` } });
    return { dir, stdout: out.stdout };
  };

  test('vercel-build runs the guarded migrate script', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    assert.match(pkg.scripts['vercel-build'], /server\/cli\/vercel-migrate\.ts/);
    assert.doesNotMatch(pkg.scripts['vercel-build'], /server\/migrate\.ts/);
  });

  test('a preview build exits 0 without touching the database; a production build migrates', async () => {
    const preview = await migrateWith({ VERCEL_ENV: 'preview' });
    assert.equal(existsSync(preview.dir), false, 'preview must not open the database');
    const unset = await migrateWith({ VERCEL_ENV: '' });
    assert.equal(existsSync(unset.dir), false);
    const prod = await migrateWith({ VERCEL_ENV: 'production' });
    assert.match(prod.stdout, /Applied: 001_init\.sql/);
    const db = createDb({ url: `pglite://${prod.dir}` });
    try {
      const rows = await db.query('SELECT name FROM schema_migrations');
      assert.ok(rows.length >= 4);
    } finally {
      await db.close();
    }
  });
});

describe('3. profile hide', () => {
  test('a hidden profile shows only the pseudonym on a public listing, its recommendations, offers and a topic', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const photo = await upload(a);
      assert.equal(photo.status, 201);
      assert.equal((await a.agent.patch('/api/me/profile', { displayName: 'Rude Name', bio: 'Rude bio', avatarPhotoId: photo.body.id })).status, 200);
      const l = await place(a, 'Probe Cafe', { whatToOrder: 'The lentil soup is good' });
      const t = await a.agent.post<{ topic: { id: string } }>('/api/talk/topics', { kind: 'discussion', title: 'Where is good tofu' });
      const shown = await app.agent().get<{ listing: { createdBy: { displayName: string | null } } }>(`/api/listings/${l.slug}`);
      assert.equal(shown.body.listing.createdBy.displayName, 'Rude Name', 'visible before the hide');

      assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'user', targetId: a.user.id, action: 'hide' })).status, 200);
      const pub = await app.agent().get<{ listing: { createdBy: { pseudonym: string; displayName: string | null; avatarUrl: string | null } } }>(`/api/listings/${l.slug}`);
      assert.deepEqual(pub.body.listing.createdBy, { pseudonym: a.user.pseudonym, displayName: null, avatarUrl: null });
      const recs = await app.agent().get<{ items: { author: unknown }[] }>(`/api/listings/${l.slug}/recommendations`);
      assert.deepEqual(recs.body.items[0].author, { pseudonym: a.user.pseudonym, displayName: null, avatarUrl: null });
      const list = await app.agent().get('/api/listings?kind=place');
      assert.ok(!JSON.stringify(list.body).includes('Rude'));
      const topic = await app.agent().get<{ topic: { author: unknown } }>(`/api/talk/topics/${t.body.topic.id}`);
      assert.deepEqual(topic.body.topic.author, { name: a.user.pseudonym, former: false });
      assert.ok(!JSON.stringify(topic.body).includes('Rude'));
      // The Home feed merged after this fix and carries its own author projection.
      const feed = await app.agent().get('/api/feed');
      assert.equal(feed.status, 200);
      assert.ok(JSON.stringify(feed.body).includes(a.user.pseudonym), 'the feed shows the member');
      assert.ok(!JSON.stringify(feed.body).includes('Rude'), 'the feed hides the display name');
      assert.ok(!JSON.stringify(feed.body).includes('/media/'), 'the feed hides the avatar');
    } finally {
      await app.close();
    }
  });
});

describe('4. photo bytes are deleted', () => {
  test('an admin hide deletes the bytes and sets deleted_at', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const p = await upload(a);
      const file = await photoPath(app, p.body.id);
      assert.ok(existsSync(file));
      assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: p.body.id, action: 'hide' })).status, 200);
      assert.equal(existsSync(file), false);
      const row = await app.db.one<{ deleted_at: Date | null }>('SELECT deleted_at FROM photos WHERE id = $1', [p.body.id]);
      assert.ok(row.deleted_at);
    } finally {
      await app.close();
    }
  });

  test('an auto hide by reports retains bytes until an admin decides', async () => {
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      const p = await upload(a);
      const file = await photoPath(app, p.body.id);
      const [r1, r2, r3] = await veterans(app, 3);
      await report(r1, 'photo', p.body.id);
      await report(r2, 'photo', p.body.id);
      assert.ok(existsSync(file));
      assert.equal((await report(r3, 'photo', p.body.id)).hidden, true);
      assert.equal(existsSync(file), true);
      const held = await app.db.one<{ hidden: boolean; deleted_at: Date | null }>('SELECT hidden,deleted_at FROM photos WHERE id=$1', [p.body.id]);
      assert.equal(held.hidden, true);
      assert.equal(held.deleted_at, null);
    } finally {
      await app.close();
    }
  });

  test('deleting an account deletes the avatar and photos not attached to visible content', async () => {
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      const avatar = await upload(a);
      const loose = await upload(a);
      const used = await upload(a);
      await a.agent.patch('/api/me/profile', { avatarPhotoId: avatar.body.id });
      const l = await place(a);
      assert.equal((await a.agent.post(`/api/listings/${l.slug}/recommendations`, { body: 'Try the mezze plate', photoId: used.body.id })).status, 201);
      const files = { avatar: await photoPath(app, avatar.body.id), loose: await photoPath(app, loose.body.id), used: await photoPath(app, used.body.id) };
      assert.equal((await a.agent.post('/api/me/delete', { password: a.password })).status, 200);
      assert.equal(existsSync(files.avatar), false, 'avatar bytes gone');
      assert.equal(existsSync(files.loose), false, 'unattached photo bytes gone');
      assert.equal(existsSync(files.used), true, 'a photo on a visible recommendation stays');
      const gone = await app.db.query('SELECT id FROM photos WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL', [[avatar.body.id, loose.body.id]]);
      assert.equal(gone.length, 2);
    } finally {
      await app.close();
    }
  });

  test('banning a member deletes their photo bytes', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const p1 = await upload(a);
      const p2 = await upload(a);
      const files = [await photoPath(app, p1.body.id), await photoPath(app, p2.body.id)];
      assert.equal((await admin.agent.post(`/api/admin/users/${a.user.id}/ban`)).status, 200);
      for (const f of files) assert.equal(existsSync(f), false);
    } finally {
      await app.close();
    }
  });

  test('a failed byte delete does not fail the request and logs the error name only', async () => {
    const app = await makeTestApp({
      media: (store) => ({ put: store.put, del: async () => { const e = new Error('secret path /x/y'); e.name = 'BlobDeleteFailed'; throw e; } }),
    });
    const spy = mock.method(console, 'error', () => undefined);
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const p = await upload(a);
      const res = await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: p.body.id, action: 'hide' });
      assert.equal(res.status, 200);
      const logged = spy.mock.calls.map((c) => c.arguments.map(String).join(' '));
      assert.ok(logged.some((l) => l.includes('BlobDeleteFailed')), JSON.stringify(logged));
      assert.ok(!logged.some((l) => l.includes('secret path')));
    } finally {
      spy.mock.restore();
      await app.close();
    }
  });
});

describe('5. dismiss and the Hidden list', () => {
  test('dismiss restores an item that reports hid automatically', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const l = await place(a, 'Real Place');
      for (const r of await veterans(app, 3)) await report(r, 'listing', l.id);
      assert.equal((await app.agent().get(`/api/listings/${l.slug}`)).status, 404);
      assert.equal((await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: l.id, action: 'dismiss' })).status, 200);
      assert.equal((await app.agent().get(`/api/listings/${l.slug}`)).status, 200);
      const q = await admin.agent.get<{ groups: { targetId: string }[] }>('/api/admin/reports');
      assert.ok(!q.body.groups.some((g) => g.targetId === l.id));
    } finally {
      await app.close();
    }
  });

  test('dismiss keeps an item an admin hid by hand hidden', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const l = await place(a, 'Spam Place');
      for (const r of await veterans(app, 3)) await report(r, 'listing', l.id);
      await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: l.id, action: 'restore' });
      await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: l.id, action: 'hide' });
      const [r4] = await veterans(app, 1);
      await report(r4, 'listing', l.id);
      await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: l.id, action: 'dismiss' });
      assert.equal((await app.agent().get(`/api/listings/${l.slug}`)).status, 404);
    } finally {
      await app.close();
    }
  });

  test('GET /api/admin/hidden lists every hidden kind and banned members; restore and unban clear them', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const b = await signUp(app.agent());
      const l = await place(a, 'Hidden Place');
      const l2 = await place(a, 'Other Place');
      const rec = await b.agent.post<{ recommendation: { id: string } }>(`/api/listings/${l2.slug}/recommendations`, { body: 'Hidden recommendation' });
      const t = await a.agent.post<{ topic: { id: string } }>('/api/talk/topics', { kind: 'discussion', title: 'Hidden topic here' });
      const rep = await a.agent.post<{ reply: { id: string } }>('/api/talk/replies', { targetType: 'listing', targetId: l2.id, body: 'Hidden reply here' });
      const p = await upload(a);
      const hide = (targetType: string, targetId: string) => admin.agent.post('/api/admin/moderate', { targetType, targetId, action: 'hide' });
      await hide('listing', l.id);
      await hide('recommendation', rec.body.recommendation.id);
      await hide('topic', t.body.topic.id);
      await hide('reply', rep.body.reply.id);
      await hide('photo', p.body.id);
      await hide('user', a.user.id);
      const banned = await signUp(app.agent());
      await admin.agent.post(`/api/admin/users/${banned.user.id}/ban`);

      // Signed in members are refused.
      assert.equal((await a.agent.get('/api/admin/hidden')).status, 403);
      const res = await admin.agent.get<{ items: { targetType: string; targetId: string; restorable: boolean }[]; banned: { id: string; pseudonym: string }[] }>('/api/admin/hidden');
      assert.equal(res.status, 200);
      const has = (type: string, id: string) => res.body.items.find((i) => i.targetType === type && i.targetId === id);
      for (const [type, id] of [['listing', l.id], ['recommendation', rec.body.recommendation.id], ['topic', t.body.topic.id], ['reply', rep.body.reply.id], ['user', a.user.id]] as const) {
        assert.ok(has(type, id), `${type} listed`);
      }
      assert.equal(has('photo', p.body.id), undefined, 'deleted photo history stays separate from restorable items');
      const photos = await admin.agent.get<typeof res.body>('/api/admin/hidden?section=photos');
      assert.equal(photos.body.items.find((i) => i.targetId === p.body.id)?.restorable, false, 'a deleted photo cannot come back');
      assert.equal(has('listing', l.id)!.restorable, true);
      const bans = await admin.agent.get<typeof res.body>('/api/admin/hidden?section=banned');
      assert.ok(bans.body.banned.some((m) => m.id === banned.user.id));

      await admin.agent.post('/api/admin/moderate', { targetType: 'listing', targetId: l.id, action: 'restore' });
      assert.equal((await admin.agent.post(`/api/admin/users/${banned.user.id}/unban`)).status, 200);
      const after = await admin.agent.get<{ items: { targetId: string }[]; banned: { id: string }[] }>('/api/admin/hidden');
      assert.ok(!after.body.items.some((i) => i.targetId === l.id));
      const bansAfter = await admin.agent.get<typeof res.body>('/api/admin/hidden?section=banned');
      assert.ok(!bansAfter.body.banned.some((m) => m.id === banned.user.id));
      const restorePhoto = await admin.agent.post('/api/admin/moderate', { targetType: 'photo', targetId: p.body.id, action: 'restore' });
      assert.equal(restorePhoto.status, 409);
    } finally {
      await app.close();
    }
  });
});

describe('6. pg pool', () => {
  test('the pool has an error listener and short lived connection settings', async () => {
    assert.equal(PG_POOL_OPTIONS.max, 5);
    assert.equal(PG_POOL_OPTIONS.idleTimeoutMillis, 5000);
    assert.equal(PG_POOL_OPTIONS.connectionTimeoutMillis, 5000);
    const pool = createPgPool('postgres://nobody@127.0.0.1:1/none');
    try {
      assert.ok(pool.listenerCount('error') >= 1);
      const spy = mock.method(console, 'error', () => undefined);
      try {
        const e = new Error('connection reset with secrets'); e.name = 'PoolBlip';
        pool.emit('error', e);
        assert.deepEqual(spy.mock.calls[0].arguments, ['pg_pool_error', 'PoolBlip']);
      } finally {
        spy.mock.restore();
      }
    } finally {
      await pool.end();
    }
  });
});

describe('7. burner reports', () => {
  test('reports from accounts younger than 72 hours do not auto hide', async () => {
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      const l = await place(a);
      const young = await veterans(app, 3, 48);
      for (const r of young) assert.equal((await report(r, 'listing', l.id)).hidden, false);
      assert.equal((await app.agent().get(`/api/listings/${l.slug}`)).status, 200);
    } finally {
      await app.close();
    }
  });

  test('a listing owner reporting never auto hides a recommendation or reply on it; the queue still shows them', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const [owner] = await veterans(app, 1);
      const s = await owner.agent.post<{ id: string; slug: string }>('/api/services', { name: 'Owner Bakes', summary: 'Small batch vegan cakes', category: 'Home baker', area: 'JLT' });
      assert.equal(s.status, 201, JSON.stringify(s.body));
      const critic = await signUp(app.agent());
      const rec = await critic.agent.post<{ recommendation: { id: string } }>(`/api/listings/${s.body.slug}/recommendations`, { body: 'The cake was dry and late' });
      const rep = await critic.agent.post<{ reply: { id: string } }>('/api/talk/replies', { targetType: 'listing', targetId: s.body.id, body: 'Not worth the price' });
      const burners = await veterans(app, 2);
      for (const [type, id] of [['recommendation', rec.body.recommendation.id], ['reply', rep.body.reply.id]] as const) {
        assert.equal((await report(owner, type, id)).hidden, false);
        for (const b of burners) assert.equal((await report(b, type, id)).hidden, false, `${type} must stay visible`);
      }
      const recs = await app.agent().get<{ items: { id: string }[] }>(`/api/listings/${s.body.slug}/recommendations`);
      assert.ok(recs.body.items.some((x) => x.id === rec.body.recommendation.id));
      const q = await admin.agent.get<{ groups: { targetId: string; openCount: number }[] }>('/api/admin/reports');
      assert.equal(q.body.groups.find((g) => g.targetId === rec.body.recommendation.id)?.openCount, 3);
      assert.equal(q.body.groups.find((g) => g.targetId === rep.body.reply.id)?.openCount, 3);
    } finally {
      await app.close();
    }
  });

  test('auto hidden items come first in the admin queue with autoHidden', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const auto = await place(a, 'Auto Hidden Place');
      const busy = await place(a, 'Busy Place');
      for (const r of await veterans(app, 3)) await report(r, 'listing', auto.id);
      // More reports, but from young accounts, so it stays visible and would sort first by count.
      for (const r of await veterans(app, 4, 1)) await report(r, 'listing', busy.id);
      const q = await admin.agent.get<{ groups: { targetId: string; autoHidden: boolean }[] }>('/api/admin/reports');
      assert.equal(q.body.groups[0].targetId, auto.id);
      assert.equal(q.body.groups[0].autoHidden, true);
      assert.equal(q.body.groups.find((g) => g.targetId === busy.id)?.autoHidden, false);
    } finally {
      await app.close();
    }
  });
});

describe('8. children of a hidden parent', () => {
  test('reply counts and search skip children of a hidden parent', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const b = await signUp(app.agent());
      const t = await a.agent.post<{ topic: { id: string } }>('/api/talk/topics', { kind: 'discussion', title: 'Where is good tofu' });
      const tid = t.body.topic.id;
      const r1 = await a.agent.post<{ reply: { id: string } }>('/api/talk/replies', { targetType: 'topic', targetId: tid, body: 'parent reply' });
      await b.agent.post('/api/talk/replies', { targetType: 'topic', targetId: tid, parentId: r1.body.reply.id, body: 'zucchinichild reply' });
      await admin.agent.post('/api/admin/moderate', { targetType: 'reply', targetId: r1.body.reply.id, action: 'hide' });
      const list = await app.agent().get<{ items: { id: string; replyCount: number }[] }>('/api/talk/topics?sort=new');
      const thread = await app.agent().get<{ total: number }>(`/api/talk/replies?target_type=topic&target_id=${tid}`);
      assert.equal(list.body.items.find((x) => x.id === tid)!.replyCount, thread.body.total);
      assert.equal(thread.body.total, 0);
      const s = await app.agent().get<{ discussions: { total: number } }>('/api/search?q=zucchinichild');
      assert.equal(s.body.discussions.total, 0);
    } finally {
      await app.close();
    }
  });
});

describe('9. banned members', () => {
  test('a banned member\'s opinions and upvotes stop counting', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const b = await signUp(app.agent());
      const l = await place(a, 'Count Me', { whatToOrder: 'Order the falafel wrap' });
      await b.agent.put(`/api/listings/${l.slug}/opinion`, { value: 'not_for_me' });
      const recs = await app.agent().get<{ items: { id: string }[] }>(`/api/listings/${l.slug}/recommendations`);
      await b.agent.put(`/api/recommendations/${recs.body.items[0].id}/upvote`);
      const t = await a.agent.post<{ topic: { id: string } }>('/api/talk/topics', { kind: 'discussion', title: 'Upvote this topic' });
      await b.agent.post(`/api/talk/topics/${t.body.topic.id}/upvote`);
      await admin.agent.post(`/api/admin/users/${b.user.id}/ban`);
      const g = await app.agent().get<{ listing: { notForMeCount: number } }>(`/api/listings/${l.slug}`);
      assert.equal(g.body.listing.notForMeCount, 0);
      const after = await app.agent().get<{ items: { upvotes: number }[] }>(`/api/listings/${l.slug}/recommendations`);
      assert.equal(after.body.items[0].upvotes, 0);
      const topic = await app.agent().get<{ topic: { upvotes: number } }>(`/api/talk/topics/${t.body.topic.id}`);
      assert.equal(topic.body.topic.upvotes, 0);
    } finally {
      await app.close();
    }
  });
});

describe('10 and 11. advisory locks', () => {
  test('report auto hide takes an advisory lock on the target before counting', async () => {
    const log: string[] = [];
    const app = await makeTestApp({ sqlLog: log });
    try {
      const a = await signUp(app.agent());
      const l = await place(a);
      const [r] = await veterans(app, 1);
      log.length = 0;
      await report(r, 'listing', l.id);
      const lock = log.findIndex((s) => /pg_advisory_xact_lock\(hashtext\(/.test(s) && /target/.test(s));
      const count = log.findIndex((s) => /count\(DISTINCT r\.user_id\)/.test(s));
      assert.ok(lock >= 0, 'lock taken');
      assert.ok(count > lock, 'lock comes before the count');
    } finally {
      await app.close();
    }
  });

  test('every daily cap check takes a per member advisory lock inside the insert transaction', async () => {
    const log: string[] = [];
    const app = await makeTestApp({ sqlLog: log });
    try {
      const a = await signUp(app.agent());
      log.length = 0;
      const l = await place(a);
      await a.agent.post(`/api/listings/${l.slug}/recommendations`, { body: 'The soup is great' });
      await a.agent.post('/api/talk/replies', { targetType: 'listing', targetId: l.id, body: 'Agreed' });
      await a.agent.post('/api/talk/topics', { kind: 'discussion', title: 'A topic for the cap' });
      await a.agent.post('/api/services', { name: 'Cap Bakes', summary: 'Small batch vegan cakes', category: 'Home baker', area: 'JLT' });
      await upload(a);
      const locks = log.filter((s) => /pg_advisory_xact_lock\(hashtext\('caps:'/.test(s)).length;
      assert.ok(locks >= 6, `expected a cap lock per write, saw ${locks}`);
    } finally {
      await app.close();
    }
  });

  test('concurrent replies cannot pass the daily cap', async () => {
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      const t = await a.agent.post<{ topic: { id: string } }>('/api/talk/topics', { kind: 'discussion', title: 'Race the cap' });
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
        a.agent.post('/api/talk/replies', { targetType: 'topic', targetId: t.body.topic.id, body: `reply number ${i}` })));
      const ok = results.filter((r) => r.status === 201).length;
      assert.equal(ok, 20, `fresh accounts get 20, saw ${ok}`);
    } finally {
      await app.close();
    }
  });
});

describe('12. listing edits after ownership changes', () => {
  test('the creator cannot PATCH once ownership was revoked', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const s = await a.agent.post<{ id: string; slug: string }>('/api/services', { name: 'Probe Bakes', summary: 'Small batch vegan cakes', category: 'Home baker', area: 'JLT' });
      assert.equal((await admin.agent.post(`/api/admin/listings/${s.body.id}/revoke-owner`)).status, 200);
      const p = await a.agent.patch(`/api/listings/${s.body.slug}`, { name: 'Probe Bakes Renamed' });
      assert.equal(p.status, 403);
      const g = await a.agent.get<{ listing: { canEdit: boolean } }>(`/api/listings/${s.body.slug}`);
      assert.equal(g.body.listing.canEdit, false);
    } finally {
      await app.close();
    }
  });

  test('the creator cannot PATCH once another member owns the listing', async () => {
    const app = await makeTestApp();
    try {
      const admin = await asAdmin(app);
      const a = await signUp(app.agent());
      const owner = await signUp(app.agent());
      const l = await place(a, 'Claimed Cafe');
      const c = await owner.agent.post(`/api/services/${l.id}/claim`);
      assert.equal(c.status, 201, JSON.stringify(c.body));
      const q = await admin.agent.get<{ claims: { id: string }[] }>('/api/admin/claims');
      assert.equal((await admin.agent.post(`/api/admin/claims/${q.body.claims[0].id}/approve`)).status, 200);
      assert.equal((await a.agent.patch(`/api/listings/${l.slug}`, { name: 'Hijacked Cafe' })).status, 403);
      // Before any ownership change the creator may still edit.
      const l2 = await place(a, 'Still Mine Cafe');
      assert.equal((await a.agent.patch(`/api/listings/${l2.slug}`, { name: 'Still Mine Cafe Two' })).status, 200);
    } finally {
      await app.close();
    }
  });
});

describe('13. poll totals', () => {
  test('totalVotes is omitted while results are hidden', async () => {
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      const b = await signUp(app.agent());
      const t = await a.agent.post<{ topic: { id: string; poll: { options: { id: string }[] } } }>('/api/talk/topics', { kind: 'poll', title: 'Best tofu brand', options: ['One', 'Two'] });
      await a.agent.post(`/api/talk/topics/${t.body.topic.id}/vote`, { optionId: t.body.topic.poll.options[0].id });
      const hidden = await b.agent.get<{ topic: { poll: Record<string, unknown> } }>(`/api/talk/topics/${t.body.topic.id}`);
      assert.equal(hidden.body.topic.poll.resultsVisible, false);
      assert.equal('totalVotes' in hidden.body.topic.poll, false);
      const anon = await app.agent().get<{ items: { id: string; poll: Record<string, unknown> }[] }>('/api/talk/topics?sort=new');
      assert.equal('totalVotes' in anon.body.items.find((x) => x.id === t.body.topic.id)!.poll, false);
      const mine = await a.agent.get<{ topic: { poll: { totalVotes?: number } } }>(`/api/talk/topics/${t.body.topic.id}`);
      assert.equal(mine.body.topic.poll.totalVotes, 1);
    } finally {
      await app.close();
    }
  });
});

describe('14. huge JPEGs', () => {
  test('a JPEG wider or taller than 4096 px is refused with 415', async () => {
    assert.equal(JPEG_MAX_SIDE, 4096);
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      for (const [w, h] of [[4097, 100], [100, 4097], [65535, 65535]]) {
        const res = await upload(a, w, h);
        assert.equal(res.status, 415, `${w}x${h}`);
        assert.match(JSON.stringify(res.body), /4096/);
      }
      assert.equal((await upload(a, 4096, 4096)).status, 201);
      const { n } = await app.db.one<{ n: number }>('SELECT count(*) AS n FROM photos');
      assert.equal(n, 1);
    } finally {
      await app.close();
    }
  });
});

describe('15. service category', () => {
  test('a service category with contact details is refused through either edit route', async () => {
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      const s = await a.agent.post<{ id: string; slug: string }>('/api/services', { name: 'Contact Bakes', summary: 'Small batch vegan cakes', category: 'Home baker', area: 'JLT' });
      const viaListings = await a.agent.patch(`/api/listings/${s.body.slug}`, { category: 'Call 050 123 4567' });
      assert.equal(viaListings.status, 400);
      const viaServices = await a.agent.patch(`/api/services/${s.body.id}`, { category: 'Call 050 123 4567' });
      assert.equal(viaServices.status, 400);
      const row = await app.db.one<{ category: string }>('SELECT category FROM listings WHERE id = $1', [s.body.id]);
      assert.equal(row.category, 'Home baker');
    } finally {
      await app.close();
    }
  });
});

describe('17. privacy page', () => {
  test('rate limit rows, which hold IP fingerprints, are deleted a day after they expire', async () => {
    const app = await makeTestApp();
    try {
      await app.db.query(`INSERT INTO rate_limits (key, hits, expires_at) VALUES ('login:ip:old', 3, now() - interval '25 hours')`);
      await app.agent().post('/api/auth/login', { email: uniqueEmail(), password: 'wrong password here' });
      assert.equal((await app.db.query(`SELECT 1 FROM rate_limits WHERE key = 'login:ip:old'`)).length, 0);
    } finally {
      await app.close();
    }
  });

  test('the privacy page states reset email, IP fingerprint and existing email facts, with no hyphens or em dashes in copy', () => {
    const src = readFileSync('src/screens/Privacy.tsx', 'utf8');
    assert.match(src, /keyed fingerprint/i);
    assert.doesNotMatch(src, /the same way/i);
    assert.match(src, /two days/i);
    assert.match(src, /slow down abuse/i);
    assert.match(src, /already has an account/i);
    assert.match(src, /Resend/);
    assert.match(src, /reset link/i);
    // Copy is the text between JSX tags; class names and code are exempt.
    const copy = [...src.matchAll(/>([^<>{}]+)</g), ...src.matchAll(/'([^'\n]* [^'\n]*\.)'/g)].map((m) => m[1]).join(' ');
    assert.match(copy, /keyed fingerprint/);
    assert.doesNotMatch(copy, /\w-\w|—/);
  });
});
