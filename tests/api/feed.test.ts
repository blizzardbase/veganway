import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { asAdmin, backdateUser, makeTestApp, signUp, type SignedUp, type TestApp } from '../helpers.js';
import type { Db } from '../../server/db.js';
import type { FeedItem, FeedPage, FeedRecommendation, FeedTopic, PinnedResponse } from '../../shared/types/feed.js';
import type { ListingDetail } from '../../shared/types/listings.js';
import type { TopicResponse } from '../../shared/types/talk.js';

let n = 0;
const stamp = () => `${++n}${Date.now().toString(36)}`;

async function addPlace(m: SignedUp, extra: Record<string, unknown> = {}): Promise<ListingDetail> {
  const res = await m.agent.post<{ listing: ListingDetail }>('/api/listings', {
    kind: 'place', name: `Feed Place ${stamp()}`, area: 'JLT', veganStatus: 'fully_vegan', ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.listing;
}

async function recommend(m: SignedUp, slug: string, body: string): Promise<string> {
  const res = await m.agent.post<{ recommendation: { id: string } }>(`/api/listings/${slug}/recommendations`, { body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.recommendation.id;
}

async function startTopic(m: SignedUp, body: Record<string, unknown>) {
  const res = await m.agent.post<TopicResponse>('/api/talk/topics', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.topic;
}

/** Move a row's created_at to a fixed number of minutes ago, so order does not depend on timing. */
async function at(db: Db, table: 'listings' | 'recommendations' | 'topics', id: string, minutesAgo: number) {
  await db.query(`UPDATE ${table} SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, minutesAgo]);
}

async function feed(agent: { get: SignedUp['agent']['get'] }, query = ''): Promise<FeedPage> {
  const res = await agent.get<FeedPage>(`/api/feed${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function allPages(agent: { get: SignedUp['agent']['get'] }, limit: number): Promise<FeedItem[]> {
  const out: FeedItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const page = await feed(agent, `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) return out;
  }
  throw new Error('pagination did not end');
}

describe('feed: signed out on an empty app', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('reads an empty feed and empty pins without an account', async () => {
    const page = await feed(app.agent());
    assert.deepEqual(page, { items: [], nextCursor: null });
    const pinned = await app.agent().get<PinnedResponse>('/api/feed/pinned');
    assert.equal(pinned.status, 200);
    assert.deepEqual(pinned.body.items, []);
    assert.equal(pinned.headers.get('cache-control'), 'no-store');
  });

  test('refuses a forged cursor and a silly page size', async () => {
    const bad = await app.agent().get<{ code: string }>('/api/feed?cursor=not-a-cursor');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'bad_cursor');
    const forged = Buffer.from(JSON.stringify({ u: 1, k: "x' OR 1=1" })).toString('base64url');
    assert.equal((await app.agent().get(`/api/feed?cursor=${forged}`)).status, 400);
    assert.equal((await app.agent().get('/api/feed?limit=500')).status, 400);
  });
});

describe('feed: content', () => {
  let app: TestApp;
  let alice: SignedUp;
  let bob: SignedUp;
  let cara: SignedUp;
  let admin: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
    bob = await signUp(app.agent());
    cara = await signUp(app.agent());
    admin = await asAdmin(app);
    for (const m of [alice, bob, cara, admin]) await backdateUser(app.db, m.user.id, 48);
  });
  after(async () => { await app.close(); });

  test('mixes new listings, recommendations and topics, newest first, and reads signed out', async () => {
    const place = await addPlace(alice, { photoId: undefined });
    const product = await alice.agent.post<{ listing: ListingDetail }>('/api/listings', {
      kind: 'product', name: `Oat Feed Milk ${stamp()}`, stores: ['Spinneys'],
    });
    assert.equal(product.status, 201);
    const recId = await recommend(bob, place.slug, 'Order the falafel wrap with extra tahini.');
    const discussion = await startTopic(cara, { kind: 'discussion', title: 'Best tofu scramble in Dubai?', body: 'Asking for a friend.' });
    await at(app.db, 'listings', place.id, 50);
    await at(app.db, 'listings', product.body.listing.id, 40);
    await at(app.db, 'recommendations', recId, 30);
    await at(app.db, 'topics', discussion.id, 20);

    const page = await feed(app.agent());
    const ours = page.items.filter((i) =>
      (i.type === 'topic' && i.topic.id === discussion.id)
      || (i.type !== 'topic' && [place.id, product.body.listing.id].includes(i.listing.id)));
    assert.deepEqual(ours.map((i) => i.type), ['topic', 'recommendation', 'listing_added', 'listing_added']);
    const times = page.items.map((i) => Date.parse(i.at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');

    const topic = ours[0] as FeedTopic;
    assert.equal(topic.id, `topic:${discussion.id}`);
    assert.equal(topic.topic.title, 'Best tofu scramble in Dubai?');
    assert.equal(topic.topic.author.name, cara.user.pseudonym);
    assert.equal(topic.topic.replyCount, 0);

    const rec = ours[1] as FeedRecommendation;
    assert.equal(rec.listing.slug, place.slug);
    assert.equal(rec.listing.name, place.name);
    assert.equal(rec.recommendation.excerpt, 'Order the falafel wrap with extra tahini.');
    assert.equal(rec.recommendation.author.pseudonym, bob.user.pseudonym);
    assert.equal(rec.recommendation.upvotedByMe, false);
    assert.equal(rec.count, 1);

    const productItem = ours[2];
    assert.equal(productItem.type, 'listing_added');
    if (productItem.type === 'listing_added') {
      assert.equal(productItem.listing.kind, 'product');
      assert.deepEqual(productItem.listing.stores, ['Spinneys']);
      assert.equal(productItem.listing.veganStatus, 'vegan_product');
      assert.equal(productItem.addedBy.pseudonym, alice.user.pseudonym);
      assert.equal(productItem.listing.recommendCount, 1, 'the creator recommends by default');
    }
    // Nothing private leaks: no email, no user ids.
    const text = JSON.stringify(page);
    assert.ok(!text.includes(alice.email) && !text.includes(alice.user.id) && !text.includes(bob.user.id));
  });

  test('the creator\'s "what to order" rides on the listing item, not as its own recommendation', async () => {
    const place = await addPlace(alice, { whatToOrder: 'The mezze platter, no feta.' });
    const page = await feed(alice.agent);
    const items = page.items.filter((i) => i.type !== 'topic' && i.listing.id === place.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'listing_added');
    if (items[0].type === 'listing_added') assert.equal(items[0].whatToOrder, 'The mezze platter, no feta.');
  });

  test('collapses several recommendations on one listing within an hour into one item with a count', async () => {
    const place = await addPlace(alice);
    const r1 = await recommend(bob, place.slug, 'First take: the burger.');
    const r2 = await recommend(cara, place.slug, 'Second take: the shake.');
    const r3 = await recommend(admin, place.slug, 'Third take: the fries.');
    const r4 = await recommend(bob, place.slug, 'Much later: the brunch.');
    await at(app.db, 'listings', place.id, 400);
    await at(app.db, 'recommendations', r1, 300);
    await at(app.db, 'recommendations', r2, 280);
    await at(app.db, 'recommendations', r3, 250);
    await at(app.db, 'recommendations', r4, 100);

    const items = (await allPages(app.agent(), 50)).filter((i): i is FeedRecommendation => i.type === 'recommendation' && i.listing.id === place.id);
    assert.equal(items.length, 2, JSON.stringify(items.map((i) => [i.count, i.recommendation.excerpt])));
    const [later, burst] = items;
    assert.equal(later.count, 1);
    assert.equal(later.recommendation.id, r4);
    assert.equal(burst.count, 3);
    assert.equal(burst.id, `rec:${r1}`, 'the group keeps the id of its first recommendation');
    assert.equal(burst.recommendation.id, r3, 'the card shows the newest in the group');
    assert.deepEqual(burst.authors, [admin.user.pseudonym, cara.user.pseudonym, bob.user.pseudonym]);
    assert.ok(Date.parse(burst.at) < Date.parse(later.at));
  });

  test('hidden listings, recommendations and topics never appear, even for admins', async () => {
    const hiddenPlace = await addPlace(alice, { name: `Hidden Feed Place ${stamp()}` });
    const shownPlace = await addPlace(alice, { name: `Shown Feed Place ${stamp()}` });
    const recOnHidden = await recommend(bob, hiddenPlace.slug, 'This one hides with its listing.');
    const hiddenRec = await recommend(bob, shownPlace.slug, 'This recommendation is hidden.');
    const hiddenTopic = await startTopic(cara, { kind: 'discussion', title: 'A hidden discussion here' });
    await app.db.query('UPDATE listings SET hidden = true WHERE id = $1', [hiddenPlace.id]);
    await app.db.query('UPDATE recommendations SET hidden = true WHERE id = $1', [hiddenRec]);
    await app.db.query('UPDATE topics SET hidden = true WHERE id = $1', [hiddenTopic.id]);

    for (const agent of [app.agent(), alice.agent, admin.agent]) {
      const text = JSON.stringify(await allPages(agent, 50));
      assert.ok(!text.includes(hiddenPlace.id), 'hidden listing');
      assert.ok(!text.includes(recOnHidden), 'recommendation on a hidden listing');
      assert.ok(!text.includes(hiddenRec), 'hidden recommendation');
      assert.ok(!text.includes('This recommendation is hidden.'));
      assert.ok(!text.includes(hiddenTopic.id), 'hidden topic');
      assert.ok(text.includes(shownPlace.id), 'the visible listing stays');
    }
  });

  test('poll results stay hidden until the viewer votes or the poll closes', async () => {
    const poll = await startTopic(cara, { kind: 'poll', title: 'Which area needs more vegan food?', options: ['Marina', 'Deira'] });
    await cara.agent.post(`/api/talk/topics/${poll.id}/vote`, { optionId: poll.poll!.options[0].id });
    const find = async (agent: { get: SignedUp['agent']['get'] }) =>
      (await allPages(agent, 50)).find((i): i is FeedTopic => i.type === 'topic' && i.topic.id === poll.id)!;

    for (const agent of [app.agent(), bob.agent]) {
      const item = await find(agent);
      assert.equal(item.topic.kind, 'poll');
      assert.deepEqual(item.topic.poll!.options.map((o) => o.label), ['Marina', 'Deira']);
      assert.equal(item.topic.poll!.resultsVisible, false);
      assert.ok(item.topic.poll!.options.every((o) => o.votes === undefined), 'no counts before a vote');
      assert.equal(item.topic.poll!.totalVotes, undefined, 'no total before a vote (fix round 1, item 13)');
    }

    const vote = await bob.agent.post(`/api/talk/topics/${poll.id}/vote`, { optionId: poll.poll!.options[1].id });
    assert.equal(vote.status, 200);
    const voted = await find(bob.agent);
    assert.equal(voted.topic.poll!.resultsVisible, true);
    assert.equal(voted.topic.poll!.myVote, poll.poll!.options[1].id);
    assert.deepEqual(voted.topic.poll!.options.map((o) => o.votes), [1, 1]);
    // Still hidden for someone who has not voted.
    assert.equal((await find(alice.agent)).topic.poll!.resultsVisible, false);

    await app.db.query(`UPDATE topics SET closes_at = now() - interval '1 minute' WHERE id = $1`, [poll.id]);
    const closed = await find(app.agent());
    assert.equal(closed.topic.poll!.closed, true);
    assert.equal(closed.topic.poll!.resultsVisible, true);
    assert.deepEqual(closed.topic.poll!.options.map((o) => o.votes), [1, 1]);
  });

  test('pinned topics come from /feed/pinned and leave the stream', async () => {
    const topic = await startTopic(alice, { kind: 'discussion', title: 'Introduce yourself here' });
    const pin = await admin.agent.post(`/api/talk/topics/${topic.id}/pin`, { pinned: true });
    assert.equal(pin.status, 200);
    const pinned = await app.agent().get<PinnedResponse>('/api/feed/pinned');
    assert.deepEqual(pinned.body.items.map((t) => t.id), [topic.id]);
    assert.equal(pinned.body.items[0].pinned, true);
    const stream = await allPages(app.agent(), 50);
    assert.ok(!stream.some((i) => i.type === 'topic' && i.topic.id === topic.id));
    await app.db.query('UPDATE topics SET hidden = true WHERE id = $1', [topic.id]);
    assert.deepEqual((await app.agent().get<PinnedResponse>('/api/feed/pinned')).body.items, []);
  });
});

describe('feed: pagination', () => {
  let app: TestApp;
  let alice: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
  });
  after(async () => { await app.close(); });

  test('pages through every item once, with no duplicates or gaps, even when times tie', async () => {
    const db = app.db;
    // 30 listings, 25 recommendations on distinct listings and 20 topics. Many share one timestamp.
    await db.tx(async (q) => {
      for (let i = 0; i < 30; i++) {
        const l = await q.one<{ id: string }>(
          `INSERT INTO listings (kind, name, slug, vegan_status, created_by, created_at)
           VALUES ('place', $1, $2, 'fully_vegan', $3, now() - make_interval(mins => $4)) RETURNING id`,
          [`Page Place ${i}`, `page-place-${i}`, alice.user.id, i % 3 === 0 ? 500 : 600 + i],
        );
        if (i < 25) {
          await q.query(
            `INSERT INTO recommendations (listing_id, user_id, body, created_at)
             VALUES ($1, $2, $3, now() - make_interval(mins => $4))`,
            [l.id, alice.user.id, `Rec ${i}`, i % 2 === 0 ? 100 : 200 + i],
          );
        }
      }
      for (let i = 0; i < 20; i++) {
        await q.query(
          `INSERT INTO topics (user_id, kind, title, created_at) VALUES ($1, 'discussion', $2, now() - make_interval(mins => $3))`,
          [alice.user.id, `Page topic ${i}`, i % 4 === 0 ? 100 : 300 + i],
        );
      }
    });

    const whole = await feed(app.agent(), '?limit=50');
    const second = await feed(app.agent(), `?limit=50&cursor=${encodeURIComponent(whole.nextCursor!)}`);
    const everything = [...whole.items, ...second.items];
    assert.equal(everything.length, 75);
    assert.equal(second.nextCursor, null);

    for (const size of [1, 7, 20]) {
      const walked = await allPages(app.agent(), size);
      const ids = walked.map((i) => i.id);
      assert.equal(new Set(ids).size, ids.length, `no duplicates at page size ${size}`);
      assert.deepEqual(ids, everything.map((i) => i.id), `same order, no gaps at page size ${size}`);
    }
    const counts = { listing_added: 0, recommendation: 0, topic: 0 };
    for (const i of everything) counts[i.type]++;
    assert.deepEqual(counts, { listing_added: 30, recommendation: 25, topic: 20 });

    const firstPage = await feed(app.agent());
    assert.equal(firstPage.items.length, 20, 'twenty per page by default');
    assert.ok(firstPage.nextCursor);
  });
});
