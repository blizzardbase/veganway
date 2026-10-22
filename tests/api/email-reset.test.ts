import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryMailer } from '../../server/lib/mailer.js';
import { asAdmin, makeTestApp, signUp } from '../helpers.js';

const confirmation = { message: 'If an account uses this email, we have sent a reset link. It works for 30 minutes.' };

test('emailed reset link works once, replaces the password and ends every existing session', async () => {
  const app = await makeTestApp();
  try {
    const member = await signUp(app.agent());
    const other = app.agent();
    await other.post('/api/auth/login', { email: member.email, password: member.password });
    const requested = await app.agent().post('/api/auth/forgot-password', { email: member.email });
    assert.equal(requested.status, 200);
    assert.deepEqual(requested.body, confirmation);
    assert.equal(app.mailer.sent.length, 1);
    const token = new URLSearchParams(new URL(app.mailer.sent[0].link).hash.slice(1)).get('token');
    assert.ok(token);
    const resetter = app.agent();
    assert.equal((await resetter.post('/api/auth/reset', { token, newPassword: 'new synthetic password' })).status, 200);
    for (const agent of [member.agent, other]) {
      assert.equal((await agent.get<{ user: unknown }>('/api/me')).body.user, null);
    }
    assert.equal((await app.agent().post('/api/auth/reset', { token, newPassword: 'another synthetic password' })).status, 401);
    assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password: member.password })).status, 401);
    assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password: 'new synthetic password' })).status, 200);
  } finally {
    await app.close();
  }
});

test('a new reset link invalidates older links, and links expire after 30 minutes', async () => {
  const app = await makeTestApp();
  try {
    const member = await signUp(app.agent());
    const request = () => app.agent().post('/api/auth/forgot-password', { email: member.email });
    const token = (index: number) => new URLSearchParams(new URL(app.mailer.sent[index].link).hash.slice(1)).get('token');
    assert.equal((await request()).status, 200);
    const row = await app.db.one<{ lifetime: number; token_hash: string; user_id: string }>(
      'SELECT extract(epoch FROM (expires_at - created_at)) AS lifetime, token_hash, user_id FROM password_reset_tokens',
    );
    assert.equal(Number(row.lifetime), 1800);
    assert.match(row.token_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(row.token_hash, token(0));
    assert.equal(row.user_id, member.user.id);
    assert.equal((await request()).status, 200);
    assert.equal((await app.agent().post('/api/auth/reset', { token: token(0), newPassword: 'synthetic new password' })).status, 401);
    await app.db.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL");
    const expired = await app.agent().post('/api/auth/reset', { token: token(1), newPassword: 'synthetic new password' });
    assert.equal(expired.status, 401);
    assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password: member.password })).status, 200);
    assert.equal((await request()).status, 200);
    assert.equal((await app.agent().post('/api/auth/reset', { token: token(2), newPassword: 'synthetic new password' })).status, 200);
  } finally {
    await app.close();
  }
});

test('unknown email gets the identical answer, database work shape and response deadline without mail', async () => {
  const sqlLog: string[] = [];
  const app = await makeTestApp({ sqlLog });
  try {
    const member = await signUp(app.agent());
    const results = [];
    for (const email of [member.email, 'unknown.synthetic@example.test']) {
      sqlLog.length = 0;
      const started = performance.now();
      const response = await app.agent().post('/api/auth/forgot-password', { email });
      results.push({ response, duration: performance.now() - started, queries: [...sqlLog] });
    }
    for (const { response, duration } of results) {
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, confirmation);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(duration >= 5400, 'both account cases wait for the shared deadline');
    }
    assert.ok(Math.abs(results[0].duration - results[1].duration) < 500, 'known and unknown response timings match within local scheduling tolerance');
    assert.deepEqual(results[0].queries, results[1].queries);
    assert.equal(app.mailer.sent.length, 1);
    assert.equal((await app.db.one<{ n: number }>('SELECT count(*) AS n FROM password_reset_tokens')).n, 1);
  } finally {
    await app.close();
  }
});

test('forgot password limits three requests per email HMAC and twenty per IP before account lookup', async () => {
  const sqlLog: string[] = [];
  const app = await makeTestApp({ sqlLog });
  try {
    const member = await signUp(app.agent());
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal((await app.agent().post('/api/auth/forgot-password', { email: member.email })).status, 200);
    }
    sqlLog.length = 0;
    assert.equal((await app.agent().post('/api/auth/forgot-password', { email: member.email.toUpperCase() })).status, 429);
    assert.equal(app.mailer.sent.length, 3);
    assert.ok(!sqlLog.some((sql) => /FROM users|password_reset_tokens/.test(sql)));
    // Sixteen fresh unknown addresses use the remaining IP allowance. The refused fourth email
    // attempt also counted against the IP, so the next address must be refused before lookup.
    const allowed = await Promise.all(Array.from({ length: 16 }, (_, i) => app.agent().post('/api/auth/forgot-password', { email: `unknown.${i}@example.test` })));
    assert.ok(allowed.every((r) => r.status === 200));
    sqlLog.length = 0;
    assert.equal((await app.agent().post('/api/auth/forgot-password', { email: 'last.unknown@example.test' })).status, 429);
    assert.ok(!sqlLog.some((sql) => /FROM users|password_reset_tokens/.test(sql)));
    assert.equal(app.mailer.sent.length, 3);
  } finally {
    await app.close();
  }
});

test('reset and delivery failures never store or log the address, token, IP or user agent', async () => {
  const logs: unknown[][] = [];
  const original = { error: console.error, log: console.log, warn: console.warn };
  const address = 'private.synthetic.recipient@example.test';
  const recorded = memoryMailer();
  const app = await makeTestApp({ mailer: { configured: true, send: async (mail, signal) => {
    await recorded.send(mail, signal);
    throw new Error(address);
  } } });
  try {
    console.error = (...args) => { logs.push(args); };
    console.log = (...args) => { logs.push(args); };
    console.warn = (...args) => { logs.push(args); };
    await signUp(app.agent(), { email: address });
    const headers = { 'user-agent': 'SyntheticPrivateBrowser' };
    const result = await app.agent().post('/api/auth/forgot-password', { email: address }, { headers });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, confirmation);
    assert.deepEqual(logs, [['password_reset_delivery_failed']]);
    const unknown = await app.agent().post('/api/auth/forgot-password', { email: 'unregistered@example.test' }, { headers });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, result.body);
    const rawToken = new URLSearchParams(new URL(recorded.sent[0].link).hash.slice(1)).get('token');
    assert.ok(rawToken);
    assert.equal((await app.agent().post('/api/auth/reset', { token: rawToken, newPassword: 'private synthetic password' }, { headers })).status, 200);
    const tables = await app.db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const rows: string[] = [];
    for (const { table_name } of tables) {
      rows.push(...(await app.db.query<{ value: string }>(`SELECT t::text AS value FROM "${table_name}" t`)).map((r) => r.value));
    }
    const dump = JSON.stringify({ rows, logs });
    for (const secret of [address, address.split('@')[0], 'unregistered@example.test', '127.0.0.1', 'SyntheticPrivateBrowser', rawToken]) assert.ok(!dump.includes(secret));
    assert.equal((await app.agent().post('/api/auth/login', { email: address, password: 'private synthetic password' })).status, 200);
    const stored = await app.db.one<{ token_hash: string }>('SELECT token_hash FROM password_reset_tokens');
    assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
  } finally {
    Object.assign(console, original);
    await app.close();
  }
});

test('unconfigured production mailer gives the same calm unavailable answer for all accounts', async () => {
  const { resendMailer } = await import('../../server/lib/mailer.js');
  const logs: unknown[][] = [];
  const original = console.error;
  const app = await makeTestApp({ mailer: resendMailer({}) });
  try {
    const member = await signUp(app.agent());
    console.error = (...args) => { logs.push(args); };
    for (const email of [member.email, 'unknown@example.test']) {
      const result = await app.agent().post('/api/auth/forgot-password', { email });
      assert.equal(result.status, 503);
      assert.deepEqual(result.body, { error: 'Password reset is not available right now. Try again later.', code: 'reset_unavailable' });
    }
    assert.deepEqual(logs, [['password_reset_mailer_unconfigured'], ['password_reset_mailer_unconfigured']]);
    assert.equal((await app.db.query('SELECT * FROM password_reset_tokens')).length, 0);
  } finally {
    console.error = original;
    await app.close();
  }
});

test('recovery codes are absent and legacy hashes are unused while password changes invalidate links', async () => {
  const app = await makeTestApp();
  try {
    const member = await signUp(app.agent());
    const legacy = 'unused-legacy-fingerprint';
    const initial = await app.db.one<{ recovery_hash: string | null }>('SELECT recovery_hash FROM users WHERE id = $1', [member.user.id]);
    assert.equal(initial.recovery_hash, null);
    await app.db.query('UPDATE users SET recovery_hash = $1 WHERE id = $2', [legacy, member.user.id]);
    assert.equal((await member.agent.post('/api/auth/recovery-code', { password: member.password })).status, 404);
    assert.equal((await app.agent().post('/api/auth/reset', { email: member.email, recoveryCode: legacy, newPassword: 'synthetic new password' })).status, 400);
    await app.agent().post('/api/auth/forgot-password', { email: member.email });
    const token = new URLSearchParams(new URL(app.mailer.sent[0].link).hash.slice(1)).get('token');
    assert.equal((await member.agent.post('/api/auth/password', { currentPassword: member.password, newPassword: 'synthetic new password' })).status, 200);
    assert.equal((await app.agent().post('/api/auth/reset', { token, newPassword: 'another new password' })).status, 401);
    assert.equal((await app.db.one<{ recovery_hash: string }>('SELECT recovery_hash FROM users WHERE id = $1', [member.user.id])).recovery_hash, legacy);
  } finally {
    await app.close();
  }
});

test('a stalled mail adapter cannot extend or change the public forgot password response', async () => {
  let deliverySignal: AbortSignal | undefined;
  const original = console.error;
  const logs: unknown[][] = [];
  const app = await makeTestApp({ mailer: {
    configured: true,
    send: (_mail, signal) => { deliverySignal = signal; return new Promise<void>(() => {}); },
  } });
  try {
    const member = await signUp(app.agent());
    console.error = (...args) => { logs.push(args); };
    const started = performance.now();
    const response = await app.agent().post('/api/auth/forgot-password', { email: member.email });
    const duration = performance.now() - started;
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, confirmation);
    assert.ok(duration >= 5400 && duration < 6500, 'response stays at its shared deadline even if delivery stalls');
    assert.equal(deliverySignal?.aborted, true);
    assert.deepEqual(logs, [['password_reset_delivery_failed']]);
  } finally {
    console.error = original;
    await app.close();
  }
});

test('banned and deleted accounts cannot use links or receive reset mail', async () => {
  const app = await makeTestApp();
  try {
    const member = await signUp(app.agent());
    await app.agent().post('/api/auth/forgot-password', { email: member.email });
    const token = new URLSearchParams(new URL(app.mailer.sent[0].link).hash.slice(1)).get('token');
    await app.db.query('UPDATE users SET banned_at = now() WHERE id = $1', [member.user.id]);
    assert.equal((await app.agent().post('/api/auth/reset', { token, newPassword: 'new synthetic password' })).status, 401);
    assert.deepEqual((await app.agent().post('/api/auth/forgot-password', { email: member.email })).body, confirmation);
    assert.equal(app.mailer.sent.length, 1);
    await app.db.query('UPDATE users SET banned_at = NULL WHERE id = $1', [member.user.id]);
    assert.equal((await member.agent.post('/api/me/delete', { password: member.password })).status, 200);
    assert.equal((await app.db.query('SELECT * FROM password_reset_tokens WHERE user_id = $1', [member.user.id])).length, 0);
    assert.equal((await app.agent().post('/api/auth/reset', { token, newPassword: 'new synthetic password' })).status, 401);
    assert.deepEqual((await app.agent().post('/api/auth/forgot-password', { email: member.email })).body, confirmation);
    assert.equal(app.mailer.sent.length, 1);
  } finally {
    await app.close();
  }
});

test('migration 130 preserves legacy account rows while new accounts need no recovery hash', async () => {
  const { createDb } = await import('../../server/db.js');
  const { readFile } = await import('node:fs/promises');
  const db = createDb({ url: 'pglite://memory' });
  try {
    await db.exec(await readFile('server/migrations/001_init.sql', 'utf8'));
    const old = await db.one<{ id: string; pw_hash: string; recovery_hash: string }>(
      `INSERT INTO users (email_hmac, pw_hash, recovery_hash, pseudonym)
       VALUES ('synthetic-email-hmac', 'synthetic-password-hash', 'legacy-recovery-hash', 'Synthetic Chickpea')
       RETURNING id, pw_hash, recovery_hash`,
    );
    await db.exec(await readFile('server/migrations/130_email_reset.sql', 'utf8'));
    assert.deepEqual(await db.one('SELECT id, pw_hash, recovery_hash FROM users WHERE id = $1', [old.id]), old);
    const fresh = await db.one<{ recovery_hash: string | null }>(
      `INSERT INTO users (email_hmac, pw_hash, pseudonym) VALUES ('new-synthetic-hmac', 'new-synthetic-password', 'Synthetic Lentil') RETURNING recovery_hash`,
    );
    assert.equal(fresh.recovery_hash, null);
    await assert.rejects(db.query(`INSERT INTO users (email_hmac, pseudonym) VALUES ('invalid-hmac', 'Invalid Lentil')`));
    assert.equal((await db.query('SELECT * FROM password_reset_tokens')).length, 0);
  } finally {
    await db.close();
  }
});

test('review: the reset link goes to the normalised address and keeps its token out of the server request', async () => {
  const app = await makeTestApp();
  try {
    const member = await signUp(app.agent());
    await app.agent().post('/api/auth/forgot-password', { email: `  ${member.email.toUpperCase()} ` });
    assert.equal(app.mailer.sent.length, 1);
    assert.equal(app.mailer.sent[0].to, member.email.toLowerCase());
    const link = new URL(app.mailer.sent[0].link);
    assert.equal(link.search, '');
    assert.match(link.hash, /^#token=[A-Za-z0-9_-]{43}$/);
  } finally {
    await app.close();
  }
});

test('review: a ban burns open reset links, so lifting it does not revive them', async () => {
  const app = await makeTestApp();
  try {
    const admin = await asAdmin(app);
    const member = await signUp(app.agent());
    await app.agent().post('/api/auth/forgot-password', { email: member.email });
    const token = new URLSearchParams(new URL(app.mailer.sent[0].link).hash.slice(1)).get('token');
    assert.equal((await admin.agent.post(`/api/admin/users/${member.user.id}/ban`)).status, 200);
    assert.equal((await admin.agent.post(`/api/admin/users/${member.user.id}/unban`)).status, 200);
    assert.equal((await app.agent().post('/api/auth/reset', { token, newPassword: 'new synthetic password' })).status, 401);
  } finally {
    await app.close();
  }
});
