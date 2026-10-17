import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, signUp, type TestApp, type SignedUp } from '../helpers.js';
import { dubaiToday } from '../../server/routes/listings.js';
import { containsContact } from '../../server/lib/contact.js';
import type { ServiceCreated, ServiceProfile } from '../../shared/types/services.js';

describe('member social contact policy', () => {
  let app: TestApp;
  let member: SignedUp;
  before(async () => { app = await makeTestApp(); member = await signUp(app.agent()); });
  after(async () => { await app.close(); });

  test('review 1: ordinary restaurant prose using at stays allowed', async () => {
    for (const body of [
      'Loved it. At the Marina branch they have oat milk.',
      'Try the burger, at Wild and The Moon',
      'Went there - at lunch',
      'Great value (AED 45) at Folly',
      'We ate at the cafe at noon.',
      'At breakfast I tried the tofu scramble.',
      'Book a table at seven for dinner.',
      'The pastries at this bakery are lovely.',
      'Meet friends at Marina Mall for lunch.',
      'There is oat milk at every branch.',
      'I had soup at lunch and curry at dinner.',
      'At AED 45, this is good value.',
    ]) {
      await app.db.query("UPDATE topics SET created_at = now() - interval '2 days' WHERE user_id = $1", [member.user.id]);
      const res = await member.agent.post('/api/talk/topics', { kind: 'discussion', title: 'Synthetic restaurant review', body });
      assert.equal(res.status, 201, body);
    }
  });

  test('review 2: maps paths and decoded queries cannot carry contact details', async () => {
    for (const body of [
      'https://maps.google.com/?q=0501234567',
      'https://www.google.com/maps/search/whatsapp+0501234567',
      'https://maps.google.com/?q=baker@example.com',
      'https://maps.apple.com/?q=t.me/veganbakes',
      'https://maps.google.com/?q=baker%40example.com',
      'https://maps.google.com/?q=baker%2540example.com',
      'https://www.google.com/maps/search/0501234567',
      'https://maps.apple.com/?q=%40veganbakes',
      'https://maps.google.com/?q=vegan&note=0501234567',
      'https://maps.google.com/?q=vegan#baker%40example.com',
    ]) {
      const res = await member.agent.post<{ code: string }>('/api/talk/topics', { kind: 'discussion', title: 'Synthetic maps check', body });
      assert.equal(res.status, 400, body);
      assert.equal(res.body.code, 'contact_details', body);
    }
    for (const body of [
      'https://www.google.com/maps/place/Synthetic+Cafe/@25.123456789,55.123456789,17z',
      'https://www.google.com/maps/place/Synthetic+Cafe/@25.123456789,55.123456789,17z/data=!4m6!3m5!1s0x3e5f000012345678:0x123456789abcdef!8m2!3d25.123456789!4d55.123456789!16s%2Fg%2F11abcdefgh',
      'https://maps.google.com/?q=25.123456789,55.123456789',
      'https://maps.apple.com/?ll=25.123456789,55.123456789&q=Synthetic+Cafe',
      'https://www.google.com/maps/search/?api=1&query=Synthetic+Cafe&query_place_id=ChIJ123456789012345',
      'https://maps.google.com/?q=place_id:ChIJ123456789012345',
      'https://www.google.com/maps/search/Synthetic+Cafe',
      'https://maps.google.com/?q=Synthetic+Cafe',
    ]) {
      await app.db.query("UPDATE topics SET created_at = now() - interval '2 days' WHERE user_id = $1", [member.user.id]);
      const res = await member.agent.post('/api/talk/topics', { kind: 'discussion', title: 'Synthetic maps search', body });
      assert.equal(res.status, 201, body);
    }
  });

  test('review 3: simple platform handles are refused without blocking restaurant prose', async () => {
    for (const body of [
      'dm me on insta veganbakes', 'IG - veganbakes', 'instagram . com/veganbakes',
      'instagram veganbakes', 'Telegram username veganbakes', 'IG: veganbakes',
    ]) {
      const res = await member.agent.post<{ code: string }>('/api/talk/topics', { kind: 'discussion', title: 'Synthetic handle check', body });
      assert.equal(res.status, 400, body);
      assert.equal(res.body.code, 'contact_details', body);
    }
    for (const body of [
      'I saw this on Instagram.', 'Their Instagram photos looked tasty.',
      'Instagram is how I found this restaurant.', 'Is this on Instagram?',
      'Try the burger, at Wild and The Moon', 'Great value (AED 45) at Folly',
    ]) {
      await app.db.query("UPDATE topics SET created_at = now() - interval '2 days' WHERE user_id = $1", [member.user.id]);
      const res = await member.agent.post('/api/talk/topics', { kind: 'discussion', title: 'Synthetic social mention', body });
      assert.equal(res.status, 201, body);
    }
  });

  test('SEC-06: social links and handles are refused in member discussions', async () => {
    const refused = [
      'https://instagram.com/synthetic_chef', 'www.facebook.com/synthetic.chef', 'fb.me/synthetic',
      'https://m.me/synthetic', 'https://www.tiktok.com/@synthetic', 't.me/synthetic',
      'telegram.me/synthetic', 'https://wa.me/message/SYNTHETIC', 'api.whatsapp.com/send?text=hello',
      'https://x.com/synthetic', 'twitter.com/synthetic', 'threads.net/@synthetic',
      'snapchat.com/add/synthetic', 'discord.gg/synthetic', 'signal.me/#synthetic',
      'linktr.ee/synthetic', 'Follow @synthetic_chef', 'Instagram: synthetic_chef',
      'Telegram handle: synthetic_chef', '＠synthetic_chef', 'insta\u200bgram.com/synthetic',
      'instagram (dot) com/synthetic', 'https://instagram.com:443/synthetic',
    ];
    for (const text of refused) {
      const res = await member.agent.post<{ code: string }>('/api/talk/topics', {
        kind: 'discussion', title: 'Synthetic contact check', body: `Find me at ${text}`,
      });
      assert.equal(res.status, 400, text);
      assert.equal(res.body.code, 'contact_details', text);
      assert.equal(containsContact(text), true, text);
    }
  });

  test('SEC-06: maps links and ordinary recipe links remain allowed in member text', async () => {
    for (const text of [
      'https://www.google.com/maps/place/25.123456789,55.123456789',
      'https://maps.google.com/?q=25.123456789,55.123456789',
      'https://maps.app.goo.gl/123456789012345', 'https://goo.gl/maps/123456789012345',
      'https://maps.apple.com/?ll=25.123456789,55.123456789', 'https://maps.apple/p/123456789012345',
      'https://recipes.example/tofu', 'The tofu costs 45 AED and serves 2',
    ]) {
      assert.equal(containsContact(text), false, text);
      await app.db.query("UPDATE topics SET created_at = now() - interval '2 days' WHERE user_id = $1", [member.user.id]);
      const res = await member.agent.post('/api/talk/topics', { kind: 'discussion', title: 'Synthetic useful link', body: text });
      assert.equal(res.status, 201, text);
    }
    assert.equal(containsContact('https://maps.google.com.evil.example/123456789012345'), true);
    assert.equal(containsContact('https://maps.google.com/?q=cafe and @synthetic_chef'), true);
    assert.equal(containsContact('https://maps.google.com/?q=cafe phone +971 50 123 4567'), true);
  });

  test('SEC-06: the shared policy protects listings, recommendations, offers, replies, profiles and service text', async () => {
    const created = await member.agent.post<{ listing: { id: string; slug: string } }>('/api/listings', {
      kind: 'place', name: 'Synthetic contact fixture', area: 'JLT', veganStatus: 'fully_vegan', opinion: null,
    });
    assert.equal(created.status, 201);
    const listing = created.body.listing;
    const attempts: [string, unknown][] = [
      ['/api/listings', { kind: 'place', name: 'Synthetic @chef', area: 'JLT', veganStatus: 'fully_vegan' }],
      [`/api/listings/${listing.slug}/recommendations`, { body: 'Contact t.me/synthetic' }],
      [`/api/listings/${listing.slug}/recommendations`, { offer: 'Contact fb.me/synthetic', offerExpiresOn: dubaiToday() }],
      ['/api/talk/replies', { targetType: 'listing', targetId: listing.id, body: 'Follow @synthetic' }],
      ['/api/services', { name: 'Synthetic cakes', summary: 'Visit instagram.com/synthetic', area: 'JLT', category: 'Home baker' }],
    ];
    for (const [path, body] of attempts) {
      const response = await member.agent.post<{ code: string }>(path, body);
      assert.equal(response.status, 400, path);
      assert.equal(response.body.code, 'contact_details', path);
    }
    const profile = await member.agent.patch<{ code: string }>('/api/me/profile', { bio: 'Follow @synthetic' });
    assert.equal(profile.status, 400);
    assert.equal(profile.body.code, 'contact_details');
  });

  test('SEC-06: owner structured contact fields remain available', async () => {
    const created = await member.agent.post<ServiceCreated>('/api/services', {
      name: 'Synthetic contact bakery', summary: 'Vegan cakes to order', area: 'JLT', category: 'Home baker',
      contact: { instagram: '@synthetic_chef', whatsapp: 'https://wa.me/971501234567', website: 'https://facebook.com/synthetic' },
    });
    assert.equal(created.status, 201);
    const profile = await member.agent.get<ServiceProfile>(`/api/services/${created.body.slug}`);
    assert.deepEqual(profile.body.contact, {
      instagram: 'synthetic_chef', whatsapp: '971501234567', website: 'https://facebook.com/synthetic',
    });
  });
});
