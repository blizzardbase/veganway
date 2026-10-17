import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { asAdmin, backdateUser, makeTestApp, signUp, type SignedUp, type TestApp } from '../helpers.js';
import { dubaiToday, normalizeMapsUrl, slugify } from '../../server/routes/listings.js';
import type {
  DealItem, ListingCard, ListingDetail, ListingSuggestion, OpinionCounts, Page, Recommendation,
} from '../../shared/types/listings.js';

type Created = { listing: ListingDetail };

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

let seq = 0;
function place(overrides: Record<string, unknown> = {}) {
  seq++;
  return { kind: 'place', name: `Test Place ${seq}`, area: 'Dubai Marina', veganStatus: 'fully_vegan', ...overrides };
}

describe('listings', () => {
  let app: TestApp;
  let alice: SignedUp;
  let bob: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
    bob = await signUp(app.agent());
  });
  after(async () => { await app.close(); });
  // Alice and Bob add many listings across tests. Age their earlier posts so the daily caps,
  // which have their own tests, do not end a later test early.
  beforeEach(async () => {
    await app.db.query(`UPDATE listings SET created_at = created_at - interval '2 days' WHERE created_by = ANY ($1::uuid[])`, [[alice.user.id, bob.user.id]]);
    await app.db.query(`UPDATE recommendations SET created_at = created_at - interval '2 days' WHERE user_id = ANY ($1::uuid[])`, [[alice.user.id, bob.user.id]]);
  });

  test('create a place: slug, preselected recommend, what to order becomes the first recommendation', async () => {
    const res = await alice.agent.post<Created>('/api/listings', {
      kind: 'place', name: 'Kale & Cocoa Kitchen', area: 'JLT', veganStatus: 'fully_vegan',
      whatToOrder: 'The jackfruit tacos', mapsUrl: 'https://maps.app.goo.gl/AbC123', category: 'Restaurant',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const l = res.body.listing;
    assert.equal(l.slug, 'kale-and-cocoa-kitchen');
    assert.equal(l.kind, 'place');
    assert.equal(l.area, 'JLT');
    assert.equal(l.veganStatus, 'fully_vegan');
    assert.equal(l.mapsUrl, 'https://maps.app.goo.gl/AbC123');
    assert.equal(l.recommendCount, 1);
    assert.equal(l.myOpinion, 'recommend');
    assert.equal(l.mine, true);
    assert.equal(l.canEdit, true);
    assert.equal(l.createdBy.pseudonym, alice.user.pseudonym);
    assert.deepEqual(Object.keys(l.createdBy).sort(), ['avatarUrl', 'displayName', 'pseudonym']);
    const recs = await app.agent().get<Page<Recommendation>>(`/api/listings/${l.slug}/recommendations`);
    assert.equal(recs.status, 200);
    assert.equal(recs.body.items.length, 1);
    assert.equal(recs.body.items[0].body, 'The jackfruit tacos');

    // Same name again gets a different slug.
    const again = await bob.agent.post<Created>('/api/listings', { kind: 'place', name: 'Kale & Cocoa Kitchen', area: 'Deira', veganStatus: 'vegan_options' });
    assert.equal(again.status, 201);
    assert.match(again.body.listing.slug, /^kale-and-cocoa-kitchen-[a-z0-9]{5}$/);
  });

  test('create a product with stores', async () => {
    const res = await alice.agent.post<Created>('/api/listings', { kind: 'product', name: 'Oat Barista Blend', stores: ['Spinneys', 'Lulu', 'Lulu'] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.listing.kind, 'product');
    assert.equal(res.body.listing.veganStatus, 'vegan_product');
    assert.deepEqual(res.body.listing.stores, ['Spinneys', 'Lulu']);
    const bad = await alice.agent.post('/api/listings', { kind: 'product', name: 'No Store Milk', stores: [] });
    assert.equal(bad.status, 400);
    const badStore = await alice.agent.post('/api/listings', { kind: 'product', name: 'Odd Store Milk', stores: ['Costco'] });
    assert.equal(badStore.status, 400);
  });

  test('a place needs a known area and a place vegan status', async () => {
    assert.equal((await alice.agent.post('/api/listings', place({ area: 'Atlantis' }))).status, 400);
    assert.equal((await alice.agent.post('/api/listings', place({ veganStatus: 'vegan_product' }))).status, 400);
    assert.equal((await alice.agent.post('/api/listings', place({ area: 'Delivery only' }))).status, 201);
  });

  test('contact details in free text are rejected', async () => {
    const inName = await alice.agent.post<{ code: string }>('/api/listings', place({ name: 'Call 050 123 4567' }));
    assert.equal(inName.status, 400);
    assert.equal(inName.body.code, 'contact_details');
    const inOrder = await alice.agent.post<{ code: string }>('/api/listings', place({ whatToOrder: 'Order on chef@example.com' }));
    assert.equal(inOrder.status, 400);
    assert.equal(inOrder.body.code, 'contact_details');
    const target = await alice.agent.post<Created>('/api/listings', place());
    const inRec = await bob.agent.post<{ code: string }>(`/api/listings/${target.body.listing.slug}/recommendations`, { body: 'whatsapp me on +971 50 123 4567' });
    assert.equal(inRec.status, 400);
    assert.equal(inRec.body.code, 'contact_details');
    const inOffer = await bob.agent.post<{ code: string }>(`/api/listings/${target.body.listing.slug}/recommendations`, {
      offer: '20% off, email deals@example.com', offerExpiresOn: addDays(dubaiToday(), 3),
    });
    assert.equal(inOffer.body.code, 'contact_details');
  });

  test('maps URL host allow list', async () => {
    const allowed = [
      'https://maps.app.goo.gl/xyz',
      'https://www.google.com/maps/place/Somewhere',
      'https://goo.gl/maps/abc',
      'https://maps.google.com/?q=25.1,55.2',
      'https://maps.apple.com/?q=cafe',
      'https://maps.apple/p/abc',
    ];
    for (const u of allowed) assert.ok(normalizeMapsUrl(u), u);
    const refused = [
      'http://maps.app.goo.gl/xyz',
      'https://evil.example/maps',
      'https://www.google.com/search?q=x',
      'https://maps.google.com.evil.example/',
      'https://user:pw@maps.google.com/',
      'https://maps.google.com:8443/',
      'javascript:alert(1)',
      'https://goo.gl/abc',
    ];
    for (const u of refused) assert.equal(normalizeMapsUrl(u), null, u);
    const res = await alice.agent.post<{ field: string }>('/api/listings', place({ mapsUrl: 'https://evil.example/maps' }));
    assert.equal(res.status, 400);
    assert.equal(res.body.field, 'mapsUrl');
    const ok = await alice.agent.post<Created>('/api/listings', place({ mapsUrl: 'https://maps.apple.com/?q=x' }));
    assert.equal(ok.status, 201);
  });

  test('suggest finds a near duplicate', async () => {
    await alice.agent.post('/api/listings', place({ name: 'Wild and the Moon' }));
    const near = await app.agent().get<{ items: ListingSuggestion[] }>(`/api/listings/suggest?q=${encodeURIComponent('kale and coco')}`);
    assert.equal(near.status, 200);
    assert.ok(near.body.items.some((s) => s.name === 'Kale & Cocoa Kitchen'), JSON.stringify(near.body));
    const typo = await app.agent().get<{ items: ListingSuggestion[] }>(`/api/listings/suggest?q=${encodeURIComponent('wild & moon')}`);
    assert.equal(typo.body.items[0]?.name, 'Wild and the Moon');
    const prefix = await app.agent().get<{ items: ListingSuggestion[] }>('/api/listings/suggest?q=wi');
    assert.equal(prefix.body.items[0]?.name, 'Wild and the Moon');
    const nothing = await app.agent().get<{ items: ListingSuggestion[] }>('/api/listings/suggest?q=zzqx');
    assert.deepEqual(nothing.body.items, []);
    assert.ok(near.body.items.length <= 5);
  });

  test('opinion set, change, remove with correct counts', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place({ opinion: null }));
    const slug = body.listing.slug;
    assert.equal(body.listing.recommendCount, 0);
    const set = await bob.agent.put<OpinionCounts>(`/api/listings/${slug}/opinion`, { value: 'recommend' });
    assert.deepEqual(set.body, { recommendCount: 1, notForMeCount: 0, myOpinion: 'recommend' });
    const again = await bob.agent.put<OpinionCounts>(`/api/listings/${slug}/opinion`, { value: 'recommend' });
    assert.deepEqual(again.body, { recommendCount: 1, notForMeCount: 0, myOpinion: 'recommend' });
    const changed = await bob.agent.put<OpinionCounts>(`/api/listings/${slug}/opinion`, { value: 'not_for_me' });
    assert.deepEqual(changed.body, { recommendCount: 0, notForMeCount: 1, myOpinion: 'not_for_me' });
    const aliceToo = await alice.agent.put<OpinionCounts>(`/api/listings/${slug}/opinion`, { value: 'recommend' });
    assert.deepEqual(aliceToo.body, { recommendCount: 1, notForMeCount: 1, myOpinion: 'recommend' });
    const removed = await bob.agent.delete<OpinionCounts>(`/api/listings/${slug}/opinion`);
    assert.deepEqual(removed.body, { recommendCount: 1, notForMeCount: 0, myOpinion: null });
    const bad = await bob.agent.put(`/api/listings/${slug}/opinion`, { value: 'love' });
    assert.equal(bad.status, 400);
  });

  test('recommendation upvote toggles once per user, and sorting follows upvotes', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place());
    const slug = body.listing.slug;
    const r1 = await alice.agent.post<{ recommendation: Recommendation }>(`/api/listings/${slug}/recommendations`, { body: 'Get the mezze plate' });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    const r2 = await bob.agent.post<{ recommendation: Recommendation }>(`/api/listings/${slug}/recommendations`, { body: 'Try the cake' });
    const id = r1.body.recommendation.id;
    const up = await bob.agent.post<{ upvoted: boolean; upvotes: number }>(`/api/recommendations/${id}/upvote`);
    assert.deepEqual(up.body, { upvoted: true, upvotes: 1 });
    const putAgain = await bob.agent.put<{ upvoted: boolean; upvotes: number }>(`/api/recommendations/${id}/upvote`);
    assert.deepEqual(putAgain.body, { upvoted: true, upvotes: 1 });
    const list = await bob.agent.get<Page<Recommendation>>(`/api/listings/${slug}/recommendations`);
    assert.equal(list.body.items[0].id, id, 'upvoted first even though older');
    assert.equal(list.body.items[0].upvotedByMe, true);
    assert.equal(list.body.items[1].id, r2.body.recommendation.id);
    const toggledOff = await bob.agent.post<{ upvoted: boolean; upvotes: number }>(`/api/recommendations/${id}/upvote`);
    assert.deepEqual(toggledOff.body, { upvoted: false, upvotes: 0 });
    const n = await app.db.one<{ n: number }>(`SELECT count(*) AS n FROM upvotes WHERE target_id = $1`, [id]);
    assert.equal(n.n, 0);
  });

  test('offers: created as a recommendation with expiry, listed while active, validated', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place({ name: 'Deal Diner' }));
    const slug = body.listing.slug;
    const today = dubaiToday();
    const offer = await bob.agent.post<{ recommendation: Recommendation }>(`/api/listings/${slug}/recommendations`, {
      offer: '2 for 1 bowls on weekdays', offerExpiresOn: addDays(today, 7),
    });
    assert.equal(offer.status, 201, JSON.stringify(offer.body));
    assert.equal(offer.body.recommendation.offer, '2 for 1 bowls on weekdays');
    assert.equal(offer.body.recommendation.body, '');
    const deals = await app.agent().get<{ items: DealItem[] }>('/api/listings/offers/active');
    assert.equal(deals.status, 200);
    const deal = deals.body.items.find((d) => d.listing.slug === slug);
    assert.ok(deal);
    assert.equal(deal.offer, '2 for 1 bowls on weekdays');
    const detail = await app.agent().get<Created>(`/api/listings/${slug}`);
    assert.equal(detail.body.listing.activeOfferCount, 1);
    assert.equal(detail.body.listing.offers.length, 1);
    const filtered = await app.agent().get<Page<ListingCard>>('/api/listings?has_offer=1');
    assert.ok(filtered.body.items.every((c) => c.activeOfferCount > 0));
    assert.ok(filtered.body.items.some((c) => c.slug === slug));

    const noDate = await bob.agent.post(`/api/listings/${slug}/recommendations`, { offer: 'Free cookie' });
    assert.equal(noDate.status, 400);
    const past = await bob.agent.post(`/api/listings/${slug}/recommendations`, { offer: 'Free cookie', offerExpiresOn: addDays(today, -1) });
    assert.equal(past.status, 400);
    const tooFar = await bob.agent.post(`/api/listings/${slug}/recommendations`, { offer: 'Free cookie', offerExpiresOn: addDays(today, 120) });
    assert.equal(tooFar.status, 400);
    const empty = await bob.agent.post(`/api/listings/${slug}/recommendations`, {});
    assert.equal(empty.status, 400);

    // An expired offer leaves the strip.
    await app.db.query(`UPDATE recommendations SET offer_expires_at = now() - interval '1 minute' WHERE id = $1`, [offer.body.recommendation.id]);
    const later = await app.agent().get<{ items: DealItem[] }>('/api/listings/offers/active');
    assert.ok(!later.body.items.some((d) => d.listing.slug === slug));
  });

  test('bookmarks of user A are invisible to user B', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place());
    const slug = body.listing.slug;
    const saved = await alice.agent.post<{ saved: boolean }>(`/api/listings/${slug}/bookmark`);
    assert.deepEqual(saved.body, { saved: true });
    const mine = await alice.agent.get<Page<ListingCard>>('/api/bookmarks');
    assert.deepEqual(mine.body.items.map((c) => c.slug), [slug]);
    const theirs = await bob.agent.get<Page<ListingCard>>('/api/bookmarks');
    assert.deepEqual(theirs.body.items, []);
    const asBob = await bob.agent.get<Created>(`/api/listings/${slug}`);
    assert.equal(asBob.body.listing.saved, false);
    const asAlice = await alice.agent.get<Created>(`/api/listings/${slug}`);
    assert.equal(asAlice.body.listing.saved, true);
    const signedOut = await app.agent().get('/api/bookmarks');
    assert.equal(signedOut.status, 401);
    const toggled = await alice.agent.post<{ saved: boolean }>(`/api/listings/${slug}/bookmark`);
    assert.deepEqual(toggled.body, { saved: false });
    const unsaveAgain = await alice.agent.delete<{ saved: boolean }>(`/api/listings/${slug}/bookmark`);
    assert.deepEqual(unsaveAgain.body, { saved: false });
  });

  test('a hidden listing is 404 for members and visible to admins', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place({ name: 'Hidden Haven' }));
    const slug = body.listing.slug;
    await app.db.query('UPDATE listings SET hidden = true WHERE slug = $1', [slug]);
    assert.equal((await bob.agent.get(`/api/listings/${slug}`)).status, 404);
    assert.equal((await alice.agent.get(`/api/listings/${slug}`)).status, 404, 'even its creator');
    assert.equal((await app.agent().get(`/api/listings/${slug}`)).status, 404);
    assert.equal((await bob.agent.put(`/api/listings/${slug}/opinion`, { value: 'recommend' })).status, 404);
    const list = await bob.agent.get<Page<ListingCard>>('/api/listings?sort=new&limit=50');
    assert.ok(!list.body.items.some((c) => c.slug === slug));
    const suggest = await bob.agent.get<{ items: ListingSuggestion[] }>('/api/listings/suggest?q=hidden');
    assert.ok(!suggest.body.items.some((c) => c.slug === slug));
    const admin = await asAdmin(app);
    const seen = await admin.agent.get<Created>(`/api/listings/${slug}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.listing.hidden, true);
  });

  test('hidden recommendations are not shown to members', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place());
    const rec = await bob.agent.post<{ recommendation: Recommendation }>(`/api/listings/${body.listing.slug}/recommendations`, { body: 'Hidden words here' });
    await app.db.query('UPDATE recommendations SET hidden = true WHERE id = $1', [rec.body.recommendation.id]);
    const list = await alice.agent.get<Page<Recommendation>>(`/api/listings/${body.listing.slug}/recommendations`);
    assert.ok(!list.body.items.some((r) => r.id === rec.body.recommendation.id));
    assert.equal((await alice.agent.post(`/api/recommendations/${rec.body.recommendation.id}/upvote`)).status, 404);
  });

  test('signed out reads work, writes return 401', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place());
    const slug = body.listing.slug;
    const visitor = app.agent();
    const list = await visitor.get<Page<ListingCard>>('/api/listings?kind=place');
    assert.equal(list.status, 200);
    assert.ok(list.body.items.length > 0);
    const detail = await visitor.get<Created>(`/api/listings/${slug}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.listing.myOpinion, null);
    assert.equal(detail.body.listing.canEdit, false);
    assert.equal((await visitor.get(`/api/listings/${slug}/recommendations`)).status, 200);
    assert.equal((await visitor.get('/api/listings/offers/active')).status, 200);
    const writes = [
      visitor.post('/api/listings', place()),
      visitor.put(`/api/listings/${slug}/opinion`, { value: 'recommend' }),
      visitor.post(`/api/listings/${slug}/bookmark`),
      visitor.post(`/api/listings/${slug}/recommendations`, { body: 'nice place' }),
      visitor.patch(`/api/listings/${slug}`, { name: 'Renamed' }),
    ];
    for (const w of await Promise.all(writes)) assert.equal(w.status, 401);
    // Public payloads never carry user ids or credentials.
    const text = JSON.stringify(detail.body) + JSON.stringify(list.body);
    assert.ok(!text.includes(alice.user.id), 'no author user id in public reads');
    assert.ok(!/email|pw_hash|recovery/i.test(text));
  });

  test('daily listing cap: 5 for a new account, 20 after a day', async () => {
    const carol = await signUp(app.agent());
    for (let i = 0; i < 5; i++) assert.equal((await carol.agent.post('/api/listings', place())).status, 201);
    const over = await carol.agent.post<{ code: string }>('/api/listings', place());
    assert.equal(over.status, 429);
    assert.equal(over.body.code, 'daily_cap');
    await backdateUser(app.db, carol.user.id, 48);
    assert.equal((await carol.agent.post('/api/listings', place())).status, 201);
  });

  test('daily post cap applies to recommendations', async () => {
    const dave = await signUp(app.agent());
    const { body } = await alice.agent.post<Created>('/api/listings', place());
    for (let i = 0; i < 20; i++) {
      const r = await dave.agent.post(`/api/listings/${body.listing.slug}/recommendations`, { body: `Tip number ${i}` });
      assert.equal(r.status, 201);
    }
    const over = await dave.agent.post(`/api/listings/${body.listing.slug}/recommendations`, { body: 'one more tip' });
    assert.equal(over.status, 429);
  });

  test('edit: creator within 24 hours, then only an admin', async () => {
    const { body } = await alice.agent.post<Created>('/api/listings', place({ name: 'Typo Cafe' }));
    const slug = body.listing.slug;
    const byBob = await bob.agent.patch(`/api/listings/${slug}`, { name: 'Bob Was Here' });
    assert.equal(byBob.status, 403);
    const fixed = await alice.agent.patch<Created>(`/api/listings/${slug}`, { name: 'Typo Café', area: 'Karama' });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.equal(fixed.body.listing.name, 'Typo Café');
    assert.equal(fixed.body.listing.area, 'Karama');
    assert.equal(fixed.body.listing.slug, slug, 'slug is stable');
    await app.db.query(`UPDATE listings SET created_at = now() - interval '25 hours' WHERE slug = $1`, [slug]);
    assert.equal((await alice.agent.patch(`/api/listings/${slug}`, { name: 'Too Late' })).status, 403);
    const admin = await asAdmin(app);
    const byAdmin = await admin.agent.patch<Created>(`/api/listings/${slug}`, { veganStatus: 'vegan_options' });
    assert.equal(byAdmin.status, 200);
    assert.equal(byAdmin.body.listing.veganStatus, 'vegan_options');
    const audit = await app.db.query(`SELECT 1 FROM audit WHERE action = 'listing.edit' AND target_id = $1`, [body.listing.id]);
    assert.equal(audit.length, 1);
  });

  test('photo on a listing must be the member\'s own', async () => {
    const other = await app.db.one<{ id: string }>(
      `INSERT INTO photos (user_id, blob_path, width, height) VALUES ($1, 'photos/x-abc.jpg', 10, 10) RETURNING id`,
      [bob.user.id],
    );
    const res = await alice.agent.post('/api/listings', place({ photoId: other.id }));
    assert.equal(res.status, 400);
    const own = await alice.agent.post<Created>('/api/listings', place({ name: 'Photo Place' }));
    assert.equal(own.status, 201);
  });

  test('list filters, sort and cursor pagination', async () => {
    const fresh = await makeTestApp();
    try {
      // An admin, because admins are exempt from the daily cap and 23 listings pass it.
      const m = await asAdmin(fresh);
      const slugs: string[] = [];
      for (let i = 0; i < 23; i++) {
        const res = await m.agent.post<Created>('/api/listings', {
          kind: 'place', name: `Paged ${i}`, area: i % 2 ? 'JLT' : 'Deira', veganStatus: i % 3 ? 'vegan_options' : 'fully_vegan', opinion: null,
        });
        slugs.push(res.body.listing.slug);
      }
      await m.agent.post('/api/listings', { kind: 'product', name: 'Store Thing', stores: ['Kibsons'] });
      const voters = [await signUp(fresh.agent()), await signUp(fresh.agent())];
      for (const v of voters) await v.agent.put(`/api/listings/${slugs[5]}/opinion`, { value: 'recommend' });
      await voters[0].agent.put(`/api/listings/${slugs[7]}/opinion`, { value: 'recommend' });

      const page1 = await fresh.agent().get<Page<ListingCard>>('/api/listings?kind=place');
      assert.equal(page1.body.items.length, 20);
      assert.equal(page1.body.items[0].slug, slugs[5], 'most recommended first');
      assert.equal(page1.body.items[1].slug, slugs[7]);
      assert.ok(page1.body.nextCursor);
      const page2 = await fresh.agent().get<Page<ListingCard>>(`/api/listings?kind=place&cursor=${page1.body.nextCursor}`);
      assert.equal(page2.body.items.length, 3);
      assert.equal(page2.body.nextCursor, null);
      const all = new Set([...page1.body.items, ...page2.body.items].map((c) => c.slug));
      assert.equal(all.size, 23);

      const newest = await fresh.agent().get<Page<ListingCard>>('/api/listings?kind=place&sort=new&limit=1');
      assert.equal(newest.body.items[0].slug, slugs[22]);
      const jlt = await fresh.agent().get<Page<ListingCard>>('/api/listings?kind=place&area=JLT&limit=50');
      assert.ok(jlt.body.items.length > 0 && jlt.body.items.every((c) => c.area === 'JLT'));
      const fully = await fresh.agent().get<Page<ListingCard>>('/api/listings?vegan_status=fully_vegan&limit=50');
      assert.ok(fully.body.items.every((c) => c.veganStatus === 'fully_vegan'));
      const store = await fresh.agent().get<Page<ListingCard>>('/api/listings?kind=product&store=Kibsons');
      assert.deepEqual(store.body.items.map((c) => c.name), ['Store Thing']);
      const services = await fresh.agent().get<Page<ListingCard>>('/api/listings?kind=service');
      assert.deepEqual(services.body.items, []);
      assert.equal((await fresh.agent().get('/api/listings?sort=random')).status, 400);
    } finally {
      await fresh.close();
    }
  });

  test('slugify keeps slugs readable', () => {
    assert.equal(slugify('Café Rösti & Co.'), 'cafe-rosti-and-co');
    assert.equal(slugify('مطعم'), '');
  });

  test('a name with no Latin letters still gets a slug', async () => {
    const res = await alice.agent.post<Created>('/api/listings', place({ name: 'مطعم نباتي' }));
    assert.equal(res.status, 201);
    assert.match(res.body.listing.slug, /^place(-[a-z0-9]{5})?$/);
    const back = await app.agent().get<Created>(`/api/listings/${res.body.listing.slug}`);
    assert.equal(back.body.listing.name, 'مطعم نباتي');
  });
});
