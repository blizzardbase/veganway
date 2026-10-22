import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { asAdmin, makeTestApp, signUp, uniqueEmail, TEST_SECRET, type TestApp } from '../helpers.js';
import { DEFAULT_LIMITS } from '../../server/lib/rate.js';
import { runAdminCommand, parseAdminArgs } from '../../server/cli/admin.js';
import { containsContact } from '../../server/lib/contact.js';
import { isReservedName } from '../../server/lib/pseudonym.js';
import type { AuthResponse, MeResponse } from '../../shared/types.js';

describe('signup', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('returns a pseudonym without a recovery code, and signs the member in', async () => {
    const agent = app.agent();
    const email = uniqueEmail('Signup');
    const res = await agent.post<AuthResponse>('/api/auth/signup', { email: `  ${email.toUpperCase()} `, password: 'a long password' });
    assert.equal(res.status, 201);
    assert.match(res.body.user.pseudonym, /^[A-Z][a-z]+ [A-Z][a-z]+( \d+)?$/);
    assert.equal(res.body.user.pseudonymConfirmed, false);
    assert.equal(res.body.user.role, 'member');
    assert.ok(!('recoveryCode' in res.body));
    assert.ok(res.body.csrf);
    const cookie = res.headers.getSetCookie().join('\n');
    assert.match(cookie, /vw_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const me = await agent.get<MeResponse>('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user?.id, res.body.user.id);
    assert.equal(me.headers.get('cache-control'), 'no-store');
  });

  test('never stores the email: no column holds it and no row in any table contains it', async () => {
    const email = uniqueEmail('Plain.Text.Check');
    await signUp(app.agent(), { email });
    const columns = await app.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`,
    );
    const names = columns.map((c) => c.column_name);
    assert.deepEqual(names.filter((n) => n.includes('email')), ['email_hmac']);
    const tables = await app.db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    assert.ok(tables.length >= 15, `expected the full schema, saw ${tables.length} tables`);
    const needles = [email.toLowerCase(), email.split('@')[0].toLowerCase()];
    let rowsSeen = 0;
    for (const { table_name } of tables) {
      const rows = await app.db.query<{ t: string }>(`SELECT t::text AS t FROM "${table_name}" t`);
      rowsSeen += rows.length;
      for (const { t } of rows) {
        for (const needle of needles) assert.ok(!t.toLowerCase().includes(needle), `${table_name} contains the email`);
      }
    }
    const userRows = await app.db.query('SELECT * FROM users WHERE NOT is_system');
    assert.ok(userRows.length >= 1 && rowsSeen > userRows.length, 'the scan read the member rows');
  });

  test('rejects a taken email, a short password and a bad email', async () => {
    const email = uniqueEmail();
    await signUp(app.agent(), { email });
    const again = await app.agent().post('/api/auth/signup', { email, password: 'another long one' });
    assert.equal(again.status, 409);
    const short = await app.agent().post<{ field: string }>('/api/auth/signup', { email: uniqueEmail(), password: 'short' });
    assert.equal(short.status, 400);
    assert.equal(short.body.field, 'password');
    const bad = await app.agent().post('/api/auth/signup', { email: 'not an email', password: 'a long password' });
    assert.equal(bad.status, 400);
  });

  test('shuffle changes the pseudonym until it is confirmed, then refuses', async () => {
    const agent = app.agent();
    const first = await agent.post<AuthResponse>('/api/auth/signup', { email: uniqueEmail(), password: 'a long password' });
    const names = new Set([first.body.user.pseudonym]);
    for (let i = 0; i < 3; i++) {
      const s = await agent.post<AuthResponse>('/api/auth/shuffle');
      assert.equal(s.status, 200);
      names.add(s.body.user.pseudonym);
    }
    assert.ok(names.size >= 2, 'shuffle produced a new name');
    const confirmed = await agent.post<AuthResponse>('/api/auth/confirm-pseudonym');
    assert.equal(confirmed.body.user.pseudonymConfirmed, true);
    const late = await agent.post('/api/auth/shuffle');
    assert.equal(late.status, 409);
  });

  test('signup per IP limit is 10 per hour', async () => {
    const strict = await makeTestApp({ limits: { signupIp: DEFAULT_LIMITS.signupIp } });
    try {
      for (let i = 0; i < 10; i++) assert.equal((await strict.agent().post('/api/auth/signup', { email: uniqueEmail(), password: 'a long password' })).status, 201);
      const hashesBefore = strict.scrypt.hash;
      const eleventh = await strict.agent().post('/api/auth/signup', { email: uniqueEmail(), password: 'a long password' });
      assert.equal(eleventh.status, 429);
      assert.equal(strict.scrypt.hash, hashesBefore, 'no scrypt after the limit');
    } finally {
      await strict.close();
    }
  });
});

describe('login and logout', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('login works with any email casing, wrong password is 401', async () => {
    const member = await signUp(app.agent());
    const agent = app.agent();
    const ok = await agent.post<AuthResponse>('/api/auth/login', { email: member.email.toUpperCase(), password: member.password });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.id, member.user.id);
    assert.equal((await agent.get<MeResponse>('/api/me')).body.user?.id, member.user.id);
    const wrong = await app.agent().post('/api/auth/login', { email: member.email, password: 'not the password' });
    assert.equal(wrong.status, 401);
    const unknown = await app.agent().post('/api/auth/login', { email: uniqueEmail('nobody'), password: 'whatever it is' });
    assert.equal(unknown.status, 401);
  });

  test('the 11th login attempt in the window returns 429 before scrypt runs', async () => {
    const member = await signUp(app.agent());
    for (let i = 1; i <= 10; i++) {
      const res = await app.agent().post('/api/auth/login', { email: member.email, password: `wrong password ${i}` });
      assert.equal(res.status, 401, `attempt ${i}`);
    }
    const verifiesBefore = app.scrypt.verify;
    const eleventh = await app.agent().post<{ code: string }>('/api/auth/login', { email: member.email, password: member.password });
    assert.equal(eleventh.status, 429);
    assert.equal(eleventh.body.code, 'rate_limited');
    assert.equal(app.scrypt.verify, verifiesBefore, 'scrypt did not run for the 11th attempt');
  });

  test('logout ends the session', async () => {
    const member = await signUp(app.agent());
    const out = await member.agent.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal((await member.agent.get<MeResponse>('/api/me')).body.user, null);
  });

  test('signed out GET /api/me is null, not an error', async () => {
    const res = await app.agent().get<MeResponse>('/api/me');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { user: null, csrf: null });
  });
});

describe('CSRF and Origin', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('a signed in write without the CSRF token returns 403', async () => {
    const member = await signUp(app.agent());
    const missing = await member.agent.post<{ code: string }>('/api/auth/logout', {}, { csrf: false });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.code, 'bad_csrf');
    const wrong = await member.agent.post('/api/auth/confirm-pseudonym', {}, { csrf: 'not-the-token' });
    assert.equal(wrong.status, 403);
    assert.ok((await member.agent.get<MeResponse>('/api/me')).body.user, 'still signed in');
  });

  test('a write from another origin, or with no Origin, returns 403', async () => {
    const foreign = await app.agent().post('/api/auth/signup', { email: uniqueEmail(), password: 'a long password' }, { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    const none = await app.agent().post('/api/auth/login', { email: uniqueEmail(), password: 'a long password' }, { origin: null });
    assert.equal(none.status, 403);
  });

  test('unknown API paths are a JSON 404 and errors never leak details', async () => {
    const res = await app.agent().get<{ code: string }>('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'not_found');
    const bad = await app.agent().request<{ code: string; error: string }>('POST', '/api/auth/login', undefined, {
      raw: { body: Buffer.from('{"email": nope'), contentType: 'application/json' },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'bad_json');
    assert.ok(!bad.body.error.includes('nope'), 'the error does not echo the body');
  });
});

describe('signed in account changes', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('change password keeps this session and ends the others', async () => {
    const member = await signUp(app.agent());
    const other = app.agent();
    await other.post('/api/auth/login', { email: member.email, password: member.password });
    const wrong = await member.agent.post('/api/auth/password', { currentPassword: 'not it at all', newPassword: 'a second password' });
    assert.equal(wrong.status, 401);
    const ok = await member.agent.post('/api/auth/password', { currentPassword: member.password, newPassword: 'a second password' });
    assert.equal(ok.status, 200);
    assert.ok((await member.agent.get<MeResponse>('/api/me')).body.user);
    assert.equal((await other.get<MeResponse>('/api/me')).body.user, null);
    assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password: 'a second password' })).status, 200);
  });
});

describe('admin role and system user', () => {
  let app: TestApp;
  before(async () => { app = await makeTestApp(); });
  after(async () => { await app.close(); });

  test('npm run admin grants and revokes by email or pseudonym, with audit', async () => {
    const member = await signUp(app.agent());
    assert.deepEqual(parseAdminArgs(['grant', '--email', member.email]), { action: 'grant', email: member.email, pseudonym: undefined });
    assert.throws(() => parseAdminArgs(['promote', '--email', 'x@y.z']));
    assert.throws(() => parseAdminArgs(['grant']));
    await runAdminCommand(app.db, TEST_SECRET, { action: 'grant', email: member.email.toUpperCase() });
    assert.equal((await member.agent.get<MeResponse>('/api/me')).body.user?.role, 'admin');
    await runAdminCommand(app.db, TEST_SECRET, { action: 'revoke', pseudonym: member.user.pseudonym.toLowerCase() });
    assert.equal((await member.agent.get<MeResponse>('/api/me')).body.user?.role, 'member');
    const entries = await app.db.query<{ action: string; actor_id: string | null; detail: Record<string, unknown> }>(
      `SELECT action, actor_id, detail FROM audit WHERE target_id = $1 ORDER BY created_at`, [member.user.id],
    );
    assert.deepEqual(entries.map((e) => e.action), ['admin.grant', 'admin.revoke']);
    assert.equal(entries[0].actor_id, null);
    await assert.rejects(runAdminCommand(app.db, TEST_SECRET, { action: 'grant', email: uniqueEmail('ghost') }));
  });

  test('asAdmin helper yields an admin, and the VeganWay system user exists but cannot log in', async () => {
    const admin = await asAdmin(app);
    assert.equal(admin.user.role, 'admin');
    const sys = await app.db.one<{ pseudonym: string; role: string; is_system: boolean; email_hmac: string | null; pw_hash: string | null }>(
      `SELECT pseudonym, role, is_system, email_hmac, pw_hash FROM users WHERE is_system`,
    );
    assert.deepEqual(sys, { pseudonym: 'VeganWay', role: 'admin', is_system: true, email_hmac: null, pw_hash: null });
  });
});

describe('shared helpers', () => {
  test('containsContact keeps rejecting phone numbers and emails', () => {
    assert.ok(containsContact('call me on +971 50 123 4567'));
    assert.ok(containsContact('mail me at baker (at) example (dot) com'));
    assert.ok(containsContact('٠٥٠١٢٣٤٥٦٧'));
    assert.ok(!containsContact('The tofu bowl is 45 AED and worth it'));
  });

  test('reserved names cover official sounding pseudonyms', () => {
    assert.ok(isReservedName('Vegan Way'));
    assert.ok(isReservedName('Site Admin'));
    assert.ok(isReservedName('Former member'));
    assert.ok(!isReservedName('Saffron Chickpea'));
  });
});
