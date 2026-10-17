import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signUp } from '../helpers.js';
import { MAX_ACCOUNTS_FOR_RESET, SYSTEM_USER_ID, WELCOME_TOPICS, resetForLaunch, seedWelcome } from '../../server/cli/launch.js';

describe('launch steps', () => {
  test('reset removes test accounts and content, keeps the system account, and seed adds pinned welcome topics once', async () => {
    const app = await makeTestApp();
    try {
      const a = await signUp(app.agent());
      await signUp(app.agent());
      const made = await a.agent.post('/api/talk/topics', { kind: 'discussion', title: 'Test topic before launch' });
      assert.equal(made.status, 201);

      assert.deepEqual(await resetForLaunch(app.db), { removedAccounts: 2 });
      const users = await app.db.query<{ id: string }>('SELECT id FROM users');
      assert.deepEqual(users.map((u) => u.id), [SYSTEM_USER_ID]);
      assert.equal((await app.db.one<{ n: number }>('SELECT count(*)::int AS n FROM topics')).n, 0);

      assert.deepEqual(await seedWelcome(app.db), { created: WELCOME_TOPICS.length });
      assert.deepEqual(await seedWelcome(app.db), { created: 0 }, 'a second seed adds nothing');

      const pinned = await app.agent().get<{ items: { title: string }[] }>('/api/feed/pinned');
      assert.equal(pinned.status, 200);
      assert.deepEqual(pinned.body.items.map((t) => t.title).sort(), [WELCOME_TOPICS[0].title, WELCOME_TOPICS[2].title].sort());
      const opts = await app.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM poll_options o JOIN topics t ON t.id = o.topic_id WHERE t.user_id = $1`, [SYSTEM_USER_ID]);
      assert.equal(opts.n, WELCOME_TOPICS[2].options!.length);
      const copy = JSON.stringify(WELCOME_TOPICS);
      assert.ok(!/[–—]/.test(copy) && !/\w-\w/.test(copy), 'welcome copy has no hyphens or em dashes');
    } finally {
      await app.close();
    }
  });

  test('review 9: reset removes photo deletion work before photos and handles merged listing references', async () => {
    const app = await makeTestApp();
    try {
      const member = await signUp(app.agent());
      const photo = await app.db.one<{ id: string }>(`INSERT INTO photos (user_id,blob_path,width,height,deleted_at)
        VALUES ($1,'synthetic-reset.jpg',1,1,now()) RETURNING id`, [member.user.id]);
      await app.db.query('UPDATE users SET avatar_photo_id=$1 WHERE id=$2', [photo.id, member.user.id]);
      const listings = await app.db.query<{ id: string }>(`INSERT INTO listings (kind,name,slug,vegan_status,created_by,photo_id)
        SELECT 'place','Reset '||n,'reset-'||n,'fully_vegan',$1,$2 FROM generate_series(1,2) n RETURNING id`, [member.user.id, photo.id]);
      await app.db.query('UPDATE listings SET hidden=true,merged_into_id=$2 WHERE id=$1', [listings[0].id, listings[1].id]);
      assert.deepEqual(await resetForLaunch(app.db), { removedAccounts: 1 });
      for (const table of ['photos', 'media_deletions', 'listings']) {
        assert.equal((await app.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).n, 0, table);
      }
    } finally { await app.close(); }
  });

  test('reset refuses once a real community exists', async () => {
    const app = await makeTestApp();
    try {
      for (let i = 0; i <= MAX_ACCOUNTS_FOR_RESET; i++) await signUp(app.agent());
      await assert.rejects(resetForLaunch(app.db), /Launch reset refused/);
      const n = await app.db.one<{ n: number }>('SELECT count(*)::int AS n FROM users');
      assert.equal(n.n, MAX_ACCOUNTS_FOR_RESET + 2, 'nothing was deleted');
    } finally {
      await app.close();
    }
  });
});
