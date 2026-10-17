import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signUp, type TestApp } from '../helpers.js';
import type { SearchResults } from '../../shared/types/search.js';

describe('search', () => {
  let app: TestApp;
  let ids: Record<string, string>;

  before(async () => {
    app = await makeTestApp();
    const m = await signUp(app.agent());
    const listing = async (kind: string, name: string, extra: { summary?: string; tags?: string[]; category?: string } = {}) =>
      (await app.db.one<{ id: string }>(
        `INSERT INTO listings (kind, name, slug, area, vegan_status, summary, tags, category, created_by)
         VALUES ($1, $2, $3, 'Al Quoz', $4, $5, $6, $7, $8) RETURNING id`,
        [kind, name, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), kind === 'product' ? 'vegan_product' : 'fully_vegan',
          extra.summary ?? '', extra.tags ?? [], extra.category ?? '', m.user.id],
      )).id;
    ids = {
      place: await listing('place', 'Green Bowl Kitchen', { summary: 'Salads and grain bowls.' }),
      product: await listing('product', 'Silken Tofu 400g'),
      service: await listing('service', 'Saffron Cakes', { summary: 'Celebration cakes.', category: 'Home baker' }),
      hiddenPlace: await listing('place', 'Tofu Palace'),
      viaReply: await listing('place', 'Corner Cafe'),
    };
    await app.db.query('UPDATE listings SET hidden = true WHERE id = $1', [ids.hiddenPlace]);
    await app.db.query(`INSERT INTO recommendations (listing_id, user_id, body) VALUES ($1, $2, 'Order the crispy tofu bao, it is amazing.')`, [ids.place, m.user.id]);
    await app.db.query(`INSERT INTO recommendations (listing_id, user_id, body, hidden) VALUES ($1, $2, 'tofu everywhere', true)`, [ids.service, m.user.id]);
    await app.db.query(`INSERT INTO replies (target_type, target_id, user_id, body) VALUES ('listing', $1, $2, 'They now do a tofu scramble on weekends.')`, [ids.viaReply, m.user.id]);
    ids.topic = (await app.db.one<{ id: string }>(
      `INSERT INTO topics (user_id, kind, title, body) VALUES ($1, 'discussion', 'Best tofu scramble in Dubai?', 'Looking for brunch.') RETURNING id`, [m.user.id])).id;
    ids.hiddenTopic = (await app.db.one<{ id: string }>(
      `INSERT INTO topics (user_id, kind, title, hidden) VALUES ($1, 'discussion', 'Tofu spam', true) RETURNING id`, [m.user.id])).id;
    ids.topicViaReply = (await app.db.one<{ id: string }>(
      `INSERT INTO topics (user_id, kind, title) VALUES ($1, 'poll', 'Weekend brunch spots') RETURNING id`, [m.user.id])).id;
    await app.db.query(`INSERT INTO replies (target_type, target_id, user_id, body) VALUES ('topic', $1, $2, 'Anything with tofu please')`, [ids.topicViaReply, m.user.id]);
  });
  after(async () => { await app.close(); });

  test('"tofu" finds a place via its recommendation, a product by name and a topic, signed out', async () => {
    const res = await app.agent().get<SearchResults>('/api/search?q=tofu');
    assert.equal(res.status, 200);
    const place = res.body.places.items.find((x) => x.id === ids.place);
    assert.ok(place, 'place found through its recommendation text');
    assert.equal(place.matchedVia, 'recommendation');
    assert.match(place.snippet ?? '', /tofu bao/);
    assert.ok(res.body.places.items.some((x) => x.id === ids.viaReply && x.matchedVia === 'reply'), 'place found through a reply');
    assert.equal(res.body.products.items[0]?.id, ids.product);
    assert.equal(res.body.products.items[0]?.matchedVia, 'listing');
    assert.ok(res.body.discussions.items.some((x) => x.id === ids.topic && x.matchedVia === 'topic'));
    assert.ok(res.body.discussions.items.some((x) => x.id === ids.topicViaReply && x.matchedVia === 'reply'));
  });

  test('hidden items, and listings matched only through hidden recommendations, are excluded', async () => {
    const res = await app.agent().get<SearchResults>('/api/search?q=tofu');
    const all = [...res.body.places.items, ...res.body.products.items, ...res.body.services.items].map((x) => x.id);
    assert.equal(all.includes(ids.hiddenPlace), false);
    assert.equal(all.includes(ids.service), false);
    assert.equal(res.body.discussions.items.some((x) => x.id === ids.hiddenTopic), false);
  });

  test('a short prefix matches listing names; totals and See all by type', async () => {
    const short = await app.agent().get<SearchResults>('/api/search?q=sil');
    assert.equal(short.body.products.items[0]?.id, ids.product);
    const word = await app.agent().get<SearchResults>('/api/search?q=caf');
    assert.ok(word.body.places.items.some((x) => x.id === ids.viaReply), 'prefix of a later word in the name');
    const cakes = await app.agent().get<SearchResults>('/api/search?q=home%20baker');
    assert.equal(cakes.body.services.items[0]?.id, ids.service);

    const top = await app.agent().get<SearchResults>('/api/search?q=tofu');
    assert.equal(top.body.places.total, 2);
    assert.ok(top.body.places.items.length <= 3);
    const seeAll = await app.agent().get<SearchResults>('/api/search?q=tofu&type=discussions');
    assert.equal(seeAll.body.discussions.total, 2);
    assert.equal(seeAll.body.places.total, 0, 'See all returns only the asked group');
  });

  test('a soft deleted reply no longer finds its topic', async () => {
    const m = await signUp(app.agent());
    const t = await app.db.one<{ id: string }>(`INSERT INTO topics (user_id, kind, title) VALUES ($1, 'discussion', 'Weekend plans') RETURNING id`, [m.user.id]);
    await app.db.query(`INSERT INTO replies (target_type, target_id, user_id, body, deleted_at) VALUES ('topic', $1, $2, 'jackfruit tacos', now())`, [t.id, m.user.id]);
    const res = await app.agent().get<SearchResults>('/api/search?q=jackfruit');
    assert.equal(res.body.discussions.total, 0);
  });

  test('empty, punctuation only and very long queries are safe', async () => {
    const empty = await app.agent().get<SearchResults>('/api/search?q=');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.places.total, 0);
    const odd = await app.agent().get<SearchResults>(`/api/search?q=${encodeURIComponent('%_\\ & | ! "')}`);
    assert.equal(odd.status, 200);
    const long = await app.agent().get<SearchResults>(`/api/search?q=${'tofu '.repeat(100)}`);
    assert.equal(long.status, 200);
    assert.ok(long.body.q.length <= 100);
  });
});

test('review 11: search offsets stop at 1000 and an empty discussion page needs one search query', async () => {
  const sql: string[] = [];
  const app = await makeTestApp({ sqlLog: sql });
  try {
    const member = await signUp(app.agent());
    await app.db.query(`INSERT INTO topics (user_id,kind,title) SELECT $1,'discussion','Synthetic offset '||n FROM generate_series(1,1005) n`, [member.user.id]);
    for (const offset of [1000, 1001, 999999999]) {
      const page = await app.agent().get<SearchResults>(`/api/search?q=offset&type=discussions&offset=${offset}`);
      assert.equal(page.status, 200);
      assert.equal(page.body.discussions.items.length, 5, `offset ${offset} is capped`);
      assert.equal(page.body.discussions.total, 1005);
    }
    sql.length = 0;
    const empty = await app.agent().get<SearchResults>('/api/search?q=unmatched&type=discussions&offset=100');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.discussions, { total: 0, items: [] });
    assert.equal(sql.filter(statement => statement.includes('websearch_to_tsquery')).length, 1, 'an empty page runs one search query');
    const pastEnd = await app.agent().get<SearchResults>('/api/search?q=offset&type=discussions&offset=999');
    assert.equal(pastEnd.body.discussions.total, 1005);
  } finally { await app.close(); }
});

test('review 11: empty discussion pages retain totals without repeating the search', async () => {
  const sql: string[] = [];
  const app = await makeTestApp({ sqlLog: sql });
  try {
    const member = await signUp(app.agent());
    await app.db.query(`INSERT INTO topics (user_id,kind,title) VALUES ($1,'discussion','Synthetic empty page fixture')`, [member.user.id]);
    sql.length = 0;
    const page = await app.agent().get<SearchResults>('/api/search?q=fixture&type=discussions&offset=100');
    assert.equal(page.status, 200);
    assert.deepEqual(page.body.discussions, { total: 1, items: [] });
    assert.equal(sql.filter(statement => statement.includes('websearch_to_tsquery')).length, 1);
  } finally { await app.close(); }
});
