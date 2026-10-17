import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signUp, type TestApp } from '../helpers.js';
import type { MyPosts, MySaved, MyService, Profile } from '../../shared/types/me.js';
import type { ServiceCreated } from '../../shared/types/services.js';

describe('me', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('profile: display name, bio and theme update; bad values are rejected', async () => {
    const m = await signUp(app.agent());
    const ok = await m.agent.patch<{ profile: Profile; user: { displayName: string } }>('/api/me/profile', { displayName: 'Layla', bio: 'Vegan for six years. Hummus critic.', theme: 'dark' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.profile.displayName, 'Layla');
    assert.equal(ok.body.profile.theme, 'dark');
    assert.equal(ok.body.user.displayName, 'Layla');

    const fetched = await m.agent.get<Profile>('/api/me/profile');
    assert.equal(fetched.body.bio, 'Vegan for six years. Hummus critic.');

    assert.equal((await m.agent.patch('/api/me/profile', { displayName: 'L' })).status, 400);
    assert.equal((await m.agent.patch('/api/me/profile', { displayName: 'x'.repeat(41) })).status, 400);
    const contact = await m.agent.patch('/api/me/profile', { displayName: 'Call 0501234567' });
    assert.equal(contact.status, 400);
    assert.equal((contact.body as { code: string }).code, 'contact_details');
    assert.equal((await m.agent.patch('/api/me/profile', { displayName: 'Site Admin' })).status, 400);
    assert.equal((await m.agent.patch('/api/me/profile', { bio: 'y'.repeat(301) })).status, 400);
    assert.equal((await m.agent.patch('/api/me/profile', { bio: 'mail me at a@b.example' })).status, 400);
    assert.equal((await m.agent.patch('/api/me/profile', { theme: 'neon' })).status, 400);
    assert.equal((await m.agent.patch('/api/me/profile', { avatarPhotoId: '00000000-0000-4000-8000-000000000999' })).status, 400);

    const cleared = await m.agent.patch<{ profile: Profile }>('/api/me/profile', { displayName: null, bio: '' });
    assert.equal(cleared.body.profile.displayName, null);
    assert.equal(cleared.body.profile.bio, null);
    assert.equal((await app.agent().get('/api/me/profile')).status, 401);
  });

  test('my posts, my saved and my service', async () => {
    const m = await signUp(app.agent());
    const other = await signUp(app.agent());
    const { body: svc } = await m.agent.post<ServiceCreated>('/api/services', {
      name: 'Zaatar Meal Prep', summary: 'Weekly plant based meal boxes for busy people.', category: 'Meal prep', area: 'JLT',
    });
    await app.db.query(`INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, 'The dal is great.')`, [svc.id, m.user.id]);
    const topic = await app.db.one<{ id: string }>(`INSERT INTO topics (user_id, kind, title) VALUES ($1, 'discussion', 'Hello all') RETURNING id`, [m.user.id]);
    await app.db.query(`INSERT INTO replies (target_type, target_id, user_id, body) VALUES ('topic', $1, $2, 'Welcome!')`, [topic.id, m.user.id]);
    await app.db.query(`INSERT INTO bookmarks (user_id, listing_id) VALUES ($1, $2)`, [m.user.id, svc.id]);

    const posts = await m.agent.get<MyPosts>('/api/me/posts');
    assert.equal(posts.body.listings[0].name, 'Zaatar Meal Prep');
    assert.equal(posts.body.recommendations[0].listing.slug, svc.slug);
    assert.equal(posts.body.topics[0].title, 'Hello all');
    assert.deepEqual(posts.body.replies[0].on, { type: 'topic', id: topic.id, title: 'Hello all' });

    const saved = await m.agent.get<MySaved>('/api/me/saved');
    assert.equal(saved.body.items.length, 1);
    const othersSaved = await other.agent.get<MySaved>('/api/me/saved');
    assert.equal(othersSaved.body.items.length, 0, 'saved items are private');

    const service = await m.agent.get<MyService>('/api/me/service');
    assert.equal(service.body.service?.slug, svc.slug);
    const none = await other.agent.get<MyService>('/api/me/service');
    assert.equal(none.body.service, null);
  });

  test('delete account keeps posts as "Former member" and login then fails', async () => {
    const m = await signUp(app.agent());
    const first = await signUp(app.agent());
    const { body: svc } = await m.agent.post<ServiceCreated>('/api/services', {
      name: 'Gone Bakery', summary: 'Sourdough and vegan croissants every Friday.', category: 'Home baker', area: 'Deira',
      contact: { instagram: '@gonebakery' },
    });
    const rec = await app.db.one<{ id: string }>(`INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, 'Lovely bread.') RETURNING id`, [svc.id, m.user.id]);
    await m.agent.patch('/api/me/profile', { displayName: 'Real Name', bio: 'About me.' });

    const wrong = await m.agent.post('/api/me/delete', { password: 'not my password' });
    assert.equal(wrong.status, 401);

    const del = await m.agent.post('/api/me/delete', { password: m.password });
    assert.equal(del.status, 200, JSON.stringify(del.body));

    const user = await app.db.one<{ pseudonym: string; email_hmac: string | null; pw_hash: string | null; recovery_hash: string | null; display_name: string | null; bio: string | null; deleted_at: Date | null }>(
      'SELECT pseudonym, email_hmac, pw_hash, recovery_hash, display_name, bio, deleted_at FROM users WHERE id = $1', [m.user.id]);
    assert.equal(user.pseudonym, 'Former member');
    assert.equal(user.email_hmac, null);
    assert.equal(user.pw_hash, null);
    assert.equal(user.recovery_hash, null);
    assert.equal(user.display_name, null);
    assert.equal(user.bio, null);
    assert.ok(user.deleted_at);
    assert.equal((await app.db.one<{ n: number }>('SELECT count(*) AS n FROM sessions WHERE user_id = $1', [m.user.id])).n, 0);

    // The post stays, under the new name.
    const post = await app.db.one<{ author: string }>('SELECT u.pseudonym AS author FROM recommendations r JOIN users u ON u.id = r.user_id WHERE r.id = $1', [rec.id]);
    assert.equal(post.author, 'Former member');
    // The listing stays but nobody runs it now, and the contact details went with the owner.
    const listing = await app.db.one<{ owner_user_id: string | null; contact: unknown }>('SELECT owner_user_id, contact FROM listings WHERE id = $1', [svc.id]);
    assert.equal(listing.owner_user_id, null);
    assert.equal(listing.contact, null);

    assert.equal((await m.agent.get<{ user: unknown }>('/api/me')).body.user, null);
    const login = await app.agent().post('/api/auth/login', { email: m.email, password: m.password });
    assert.equal(login.status, 401);

    // A second deleted account can also be "Former member".
    const del2 = await first.agent.post('/api/me/delete', { password: first.password });
    assert.equal(del2.status, 200);
    // And the email can sign up again as a new member.
    const again = await app.agent().post('/api/auth/signup', { email: m.email, password: 'a fresh long password' });
    assert.equal(again.status, 201);
  });
});
