import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { importRecordSchema, sourceKey } from '../../server/cli/import-history.js';
import { migrate } from '../../server/migrate.js';
import { DUBAI_AREAS } from '../../shared/types/listings.js';
import type { SearchResults } from '../../shared/types/search.js';
import { SERVICE_AREAS } from '../../shared/types/services.js';
import { makeTestApp, signUp, type TestApp, type SignedUp } from '../helpers.js';
import type { ListingCard, ListingDetail, Page } from '../../shared/types/listings.js';

describe('discovery fixes', () => {
  let app: TestApp;
  let owner: SignedUp;
  before(async () => { app = await makeTestApp(); owner = await signUp(app.agent()); });
  after(async () => { await app.close(); });

  test('DATA-05: Most recommended ranks by count, then net opinion, across pages', async () => {
    const listings: ListingDetail[] = [];
    for (const name of ['Popular disputed', 'Popular positive', 'Less popular']) {
      const response = await owner.agent.post<{ listing: ListingDetail }>('/api/listings', {
        kind: 'place', name, area: 'JLT', veganStatus: 'fully_vegan', opinion: null,
      });
      assert.equal(response.status, 201);
      listings.push(response.body.listing);
    }
    const voters = await app.db.query<{ id: string }>(`INSERT INTO users (email_hmac, pw_hash, recovery_hash, pseudonym)
      SELECT 'disc-voter-' || n, 'synthetic', 'synthetic', 'Disc voter ' || n FROM generate_series(1,5) n RETURNING id`);
    for (const [index, values] of [
      ['recommend', 'recommend', 'not_for_me', 'not_for_me', 'not_for_me'],
      ['recommend', 'recommend'],
      ['recommend'],
    ].entries()) {
      for (const [voter, value] of values.entries()) {
        await app.db.query('INSERT INTO opinions (listing_id, user_id, value) VALUES ($1, $2, $3)', [listings[index].id, voters[voter].id, value]);
      }
    }
    const first = await app.agent().get<Page<ListingCard>>('/api/listings?sort=top&limit=2');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.items.map((l) => l.name), ['Popular positive', 'Popular disputed']);
    assert.ok(first.body.nextCursor);
    const next = await app.agent().get<Page<ListingCard>>(`/api/listings?sort=top&limit=2&cursor=${first.body.nextCursor}`);
    assert.deepEqual(next.body.items.map((l) => l.name), ['Less popular']);
    assert.equal(next.body.nextCursor, null);
  });
});


describe('canonical areas', () => {
  let app: TestApp;
  let owner: SignedUp;
  before(async () => { app = await makeTestApp(); owner = await signUp(app.agent()); });
  after(async () => { await app.close(); });

  test('DATA-04: place, service and import choices share canonical values and delivery spans area filters', async () => {
    assert.deepEqual(SERVICE_AREAS, DUBAI_AREAS);
    for (const [index, area] of DUBAI_AREAS.entries()) {
      for (const kind of ['place', 'service'] as const) {
        const name = `Synthetic import ${kind}`;
        assert.equal(importRecordSchema.safeParse({
          id: sourceKey(name), source_key: sourceKey(name), kind, name, area,
          vegan_status: 'fully_vegan', category: '', tags: [], stores: [], summary: '',
        }).success, true, `${kind} import in ${area}`);
      }
      await app.db.query("UPDATE listings SET created_at = now() - interval '2 days'");
      const place = await owner.agent.post<{ listing: ListingDetail }>('/api/listings', {
        kind: 'place', name: `Canonical place ${index}`, area, veganStatus: 'fully_vegan', opinion: null,
      });
      assert.equal(place.status, 201, area);
      const service = await owner.agent.post<{ id: string; slug: string }>('/api/services', {
        name: `Canonical service ${index}`, summary: 'Synthetic vegan food', category: 'Home baker', area,
      });
      assert.equal(service.status, 201, area);
      const filtered = await app.agent().get<Page<ListingCard>>(`/api/listings?kind=service&area=${encodeURIComponent(area)}&limit=50`);
      assert.ok(filtered.body.items.some((l) => l.id === service.body.id), area);
    }
    for (const area of DUBAI_AREAS) {
      const filtered = await app.agent().get<Page<ListingCard>>(`/api/listings?kind=service&area=${encodeURIComponent(area)}&limit=50`);
      assert.ok(filtered.body.items.some((l) => l.area === 'Delivery only'), `delivery under ${area}`);
    }
    const refused = await owner.agent.post('/api/services', {
      name: 'Unknown area service', summary: 'Synthetic vegan food', category: 'Home baker', area: 'Atlantis',
    });
    assert.equal(refused.status, 400);
  });

  test('DATA-04: migration 090 converts legacy areas and preserves imported canonical areas and missing areas', async () => {
    await app.db.query("DELETE FROM listings");
    const old = ['Downtown', 'Delivers across Dubai', 'Motor City', 'Satwa', null];
    const values = [...old, ...DUBAI_AREAS];
    for (const [index, area] of values.entries()) {
      await app.db.query(`INSERT INTO listings (kind, name, slug, area, vegan_status, created_by, source_key)
        VALUES ('service', $1, $2, $3, 'fully_vegan', $4, $5)`,
      [`Migration fixture ${index}`, `migration-fixture-${index}`, area, owner.user.id, `synthetic-canonical-${index}`]);
    }
    await app.db.query("DELETE FROM schema_migrations WHERE name LIKE '090_%'");
    const applied = await migrate(app.db);
    assert.ok(applied.some((name) => name.startsWith('090_')));
    const rows = await app.db.query<{ area: string | null }>('SELECT area FROM listings ORDER BY substring(slug from 19)::int');
    assert.deepEqual(rows.map((r) => r.area), ['Downtown Dubai', 'Delivery only', 'Motor City', 'Satwa', null, ...DUBAI_AREAS]);
    assert.deepEqual(await migrate(app.db), [], 'migration is recorded and runs once');
  });
});


describe('complete category search', () => {
  let app: TestApp;
  before(async () => {
    app = await makeTestApp();
    const author = await signUp(app.agent());
    await app.db.query(`INSERT INTO listings (kind, name, slug, area, vegan_status, created_by, created_at)
      SELECT 'place', 'Synthetic search ' || n, 'synthetic-search-' || n, 'JLT', 'fully_vegan', $1, '2026-01-01'
      FROM generate_series(1,1002) n`, [author.user.id]);
    await app.db.query(`INSERT INTO topics (user_id, kind, title, created_at)
      SELECT $1, 'discussion', 'Synthetic search ' || n, '2026-01-01' FROM generate_series(1,1002) n`, [author.user.id]);
  });
  after(async () => { await app.close(); });

  test('UX-03: category search caps offsets at 1000 and retains totals', async () => {
    for (const type of ['places', 'discussions'] as const) {
      const last = await app.agent().get<SearchResults>(`/api/search?q=Synthetic&type=${type}&offset=1001`);
      assert.equal(last.body[type].items.length, 2, type);
      assert.equal(last.body[type].total, 1002, type);
      const end = await app.agent().get<SearchResults>(`/api/search?q=Synthetic&type=${type}&offset=1020`);
      assert.equal(end.body[type].items.length, 2, type);
      assert.equal(end.body[type].total, 1002, type);
    }
  });
});
