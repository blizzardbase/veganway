// WhatsApp history import: parsing, redaction and the listings only importer.
// Every chat line here is synthetic. Real chat lines never enter the repository.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { makeTestApp, signUp } from '../helpers.js';
import { parseChat } from '../../scripts/import/parse.js';
import { nameScrubber, redactMessages, redactText, senderId, systemReason } from '../../scripts/import/redact.js';
import { buildRecords, type Spec } from '../../scripts/import/records.js';
import {
  importHistory, normaliseName, parseExclusions, parseImportFile, sourceKey, type ImportRecord,
} from '../../server/cli/import-history.js';
import { SYSTEM_USER_ID } from '../../server/cli/launch.js';

const NNBSP = '\u202f';
const LRM = '\u200e';

const CHAT = [
  `[03/09/2026, 9:05:03${NNBSP}PM] Group Owner: ${LRM}Messages and calls are end-to-end encrypted.`,
  `${LRM}[03/09/2026, 9:06:00${NNBSP}PM] Sage Morrow: ${LRM}~ Sage Morrow joined using a group link`,
  `[03/09/2026, 9:07:10${NNBSP}PM] Sage Morrow: Thanks Sage for the tip! Call me on +971 50 123 4567 or 050 123 4567`,
  `[03/09/2026, 9:08:00${NNBSP}PM] ~ Bex Thorne: Indian line +91 98765 43210, also 98765-43210 and 00971501234567`,
  `continued on a second line with baker@example.com and https://wa.me/971501234567`,
  `[04/09/2026, 12:15:00${NNBSP}AM] Bex Thorne: Ask @\u2068~Sage Morrow\u2069 or @971501234567, the sage leaves are lovely ${LRM}<This message was edited>`,
  `${LRM}[04/09/2026, 8:00:00${NNBSP}AM] Bex Thorne: ${LRM}image omitted`,
  `[04/09/2026, 8:01:00${NNBSP}AM] Bex Thorne: This message was deleted.`,
  `[04/09/2026, 8:02:00${NNBSP}AM] Fennel: *Introducing Fennel Bakehouse* in JLT. Fennel croissants daily`,
  `[04/09/2026, 8:03:00${NNBSP}AM] Zora Quill:`,
  `Multiline text that starts on the next line, from Zora and Bex`,
  `[05/09/2026, 12:30:00${NNBSP}PM] Zora Quill: Loved the cake ${LRM}image omitted`,
  `[05/09/2026, 12:31:00${NNBSP}PM] +971 55 000 1111: null`,
].join('\n');

describe('WhatsApp import: parse and redact', () => {
  test('the parser reads iOS lines with AM/PM, marks and multiline messages', () => {
    const ms = parseChat(CHAT);
    assert.equal(ms.length, 11);
    assert.equal(ms[0].date, '2026-09-03T21:05:03');
    assert.equal(ms[4].date, '2026-09-04T00:15:00', '12 AM is midnight');
    assert.equal(ms[3].sender, 'Bex Thorne', 'the ~ prefix is stripped');
    assert.match(ms[3].text, /\nContinued|\ncontinued/);
    assert.equal(ms[8].sender, 'Zora Quill');
    assert.equal(ms[8].text, '\nMultiline text that starts on the next line, from Zora and Bex');
  });

  test('system lines are dropped with a reason', () => {
    assert.equal(systemReason(`${LRM}Messages and calls are end-to-end encrypted.`), 'encryption_notice');
    assert.equal(systemReason(`${LRM}~ Sage Morrow joined using a group link`), 'joined_left_added');
    assert.equal(systemReason(`${LRM}image omitted`), 'media_omitted');
    assert.equal(systemReason('This message was deleted.'), 'deleted');
    assert.equal(systemReason('null'), 'null');
    assert.equal(systemReason(`${LRM}Zora Quill changed the subject to "Vegans"`), 'subject_or_settings');
    assert.equal(systemReason(`${LRM}Your security code with Zora Quill changed.`), 'security_code');
    assert.equal(systemReason('I left early and joined later'), null, 'member text is never a system line');
  });

  test('redaction removes numbers, emails, wa.me links, mentions and member names, and keeps business names', () => {
    const key = randomBytes(32);
    const { kept, dropped } = redactMessages(parseChat(CHAT), key);
    assert.deepEqual(dropped, { encryption_notice: 1, joined_left_added: 1, media_omitted: 1, deleted: 1, null: 1 });
    const all = kept.map((m) => m.text).join('\n');
    for (const leak of ['123 4567', '98765', '971501234567', '000 1111', 'example.com', 'wa.me', '@', 'Sage Morrow', 'Thanks Sage', 'Bex', 'Zora', 'Quill', 'Thorne', 'edited', 'omitted']) {
      assert.ok(!all.includes(leak), `"${leak}" must not survive redaction`);
    }
    assert.ok(!/\d{7,}/.test(all), 'no run of seven or more digits');
    assert.match(all, /Thanks \[member\] for the tip! Call me on \[number\] or \[number\]/);
    assert.match(all, /the sage leaves are lovely$/m, 'a lowercase word that matches a name word stays');
    assert.match(all, /Introducing Fennel Bakehouse\* in JLT\. Fennel croissants daily/, 'a business posting as itself keeps its name');
    assert.match(all, /^Loved the cake$/m);
    // Sender ids are opaque, stable for one key and different under another.
    assert.ok(kept.every((m) => /^m_[0-9a-f]{12}$/.test(m.senderId)));
    assert.equal(senderId(key, 'Bex Thorne'), senderId(key, 'bex thorne '));
    assert.notEqual(senderId(key, 'Bex Thorne'), senderId(randomBytes(32), 'Bex Thorne'));
  });

  test('redactText alone catches UAE and Indian formats and an address written out', () => {
    const scrub = nameScrubber(['Will Harrow']);
    assert.equal(redactText('Will said it will rain, WILL HARROW agreed', scrub), '[member] said it will rain, [member] agreed');
    assert.equal(redactText('Landline 04 123 4567 or +91-98765-43210', scrub), 'Landline [number] or [number]');
    assert.equal(redactText('write to cakes at example dot com', scrub), '', 'the app check drops what the patterns missed');
  });

  test('the records builder counts distinct messages and months, and sets source_key', () => {
    const spec: Spec = {
      listings: [{
        name: 'Fennel Bakehouse', kind: 'place', area: 'JLT', vegan_status: 'vegan_options', category: 'Bakery',
        tags: ['croissants'], stores: [], summary: 'Bakery in JLT with croissants.', match: ['fennel'],
      }],
      dropped: [],
    };
    const msgs = [
      { date: '2026-09-04T08:02:00', senderId: 'm_1', text: 'Fennel croissants' },
      { date: '2026-09-05T08:02:00', senderId: 'm_2', text: 'Fennel croissants' },
      { date: '2026-10-01T08:02:00', senderId: 'm_2', text: 'fennel again' },
    ];
    const { records } = buildRecords(spec, msgs);
    assert.equal(records[0].source_key, sourceKey('Fennel Bakehouse'));
    assert.deepEqual(records[0].preview, { messages: 2, months: ['2026-09', '2026-10'] });
  });
});

function rec(name: string, over: Partial<ImportRecord> = {}): ImportRecord {
  const key = sourceKey(name);
  return parseImportFile([{
    id: key, source_key: key, kind: 'place', name, area: 'JLT', vegan_status: 'vegan_options', category: 'Cafe',
    tags: ['brunch'], stores: [], summary: `Cafe in JLT.`, preview: { messages: 3, months: ['2026-09'] }, ...over,
  }]).records[0];
}

describe('WhatsApp import: listings only importer', () => {
  test('imports listings once, honours exclusions, skips a listing a member already added, and creates nothing else', async () => {
    const app = await makeTestApp();
    try {
      const alice = await signUp(app.agent());
      const made = await alice.agent.post('/api/listings', { kind: 'place', name: 'Moonleaf Café', veganStatus: 'fully_vegan', area: 'JLT' });
      assert.equal(made.status, 201);

      const records = [
        rec('Quillfeather Kitchen'),
        rec('Moonleaf Cafe'),
        rec('Thornbury Oat Milk', { kind: 'product', area: null, vegan_status: 'vegan_product', category: 'Dairy free', stores: ['Spinneys'], summary: 'Oat milk sold at Spinneys.' }),
        rec('Sorrel Home Bakes', { kind: 'service', area: 'Mirdif', category: 'Home baker', summary: 'Home baker in Mirdif.' }),
        rec('Excluded Eatery'),
      ];
      const first = await importHistory(app.db, records, [records[4].id]);
      assert.deepEqual(first, { inserted: 3, excluded: 1, skippedSourceKey: 0, skippedName: 1 });

      const second = await importHistory(app.db, records, [records[4].id]);
      assert.deepEqual(second, { inserted: 0, excluded: 1, skippedSourceKey: 3, skippedName: 1 }, 'a second run adds nothing');

      const rows = await app.db.query<{ name: string; created_by: string; owner_user_id: string | null; contact: unknown; source_key: string; slug: string }>(
        'SELECT name, created_by, owner_user_id, contact, source_key, slug FROM listings WHERE source_key IS NOT NULL ORDER BY name');
      assert.deepEqual(rows.map((r) => r.name), ['Quillfeather Kitchen', 'Sorrel Home Bakes', 'Thornbury Oat Milk']);
      for (const r of rows) {
        assert.equal(r.created_by, SYSTEM_USER_ID);
        assert.equal(r.owner_user_id, null);
        assert.equal(r.contact, null);
        assert.equal(r.source_key, sourceKey(r.name));
      }
      // The member's own listing carries her opinion; the imported ones carry nothing.
      const imported = `SELECT id FROM listings WHERE source_key IS NOT NULL`;
      for (const sql of [
        `SELECT count(*)::int AS n FROM recommendations WHERE listing_id IN (${imported})`,
        `SELECT count(*)::int AS n FROM opinions WHERE listing_id IN (${imported})`,
        `SELECT count(*)::int AS n FROM replies WHERE target_type = 'listing' AND target_id IN (${imported})`,
        `SELECT count(*)::int AS n FROM recommendations`,
        `SELECT count(*)::int AS n FROM topics`,
      ]) {
        assert.equal((await app.db.one<{ n: number }>(sql)).n, 0, sql);
      }
      const page = await app.agent().get<{ listing: { name: string; recommendCount: number } }>(`/api/listings/${rows[0].slug}`);
      assert.equal(page.status, 200);
      assert.equal(page.body.listing.recommendCount, 0, 'an imported listing starts with zero recommendations');
      const audits = await app.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit WHERE action = 'import_history'`);
      assert.equal(audits.n, 2);
    } finally {
      await app.close();
    }
  });

  test('the file parser rejects contact details, wrong areas and a mismatched source_key', () => {
    assert.throws(() => rec('Bad Summary Cafe', { summary: 'Call 050 123 4567' }), /contact details/);
    assert.throws(() => rec('Atlantis Cafe', { area: 'Atlantis' }), /is not allowed for a place/);
    assert.throws(() => rec('Product With Area', { kind: 'product', vegan_status: 'vegan_product', category: 'Snacks' }), /a product has no area/);
    const key = sourceKey('Something Else');
    assert.throws(() => parseImportFile([{ ...rec('Real Name'), source_key: key, id: key }]), /source_key is not/);
    const wrapped = parseImportFile({ records: [rec('Wrapped Cafe')], exclude: ['x'] });
    assert.deepEqual(wrapped.exclude, ['x']);
    assert.deepEqual(parseExclusions({ exclude: ['a', 'b'] }), ['a', 'b']);
    assert.deepEqual(parseExclusions(['c']), ['c']);
    assert.equal(normaliseName("  Kre’ate & Co. "), 'kreate and co');
  });
});
