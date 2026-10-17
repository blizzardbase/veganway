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
