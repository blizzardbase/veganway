import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../../server/app.js';
import { createDb } from '../../server/db.js';
import { migrate } from '../../server/migrate.js';
import { memoryMailer } from '../../server/lib/mailer.js';
import { scryptHasher } from '../../server/lib/crypto.js';
import { Agent, makeTestApp, signUp, uniqueEmail, TEST_ORIGIN, TEST_SECRET } from '../helpers.js';
import type { AuthResponse, MeResponse } from '../../shared/types.js';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function raceApp(options: { signupBarrier?: number; signupGlobalMax?: number } = {}) {
  const db = createDb({ url: 'pglite://memory' });
  await migrate(db);
  let pauseHash: { reached: ReturnType<typeof signal>; resume: ReturnType<typeof signal> } | undefined;
  let pause: { reached: ReturnType<typeof signal>; resume: ReturnType<typeof signal> } | undefined;
  let hashing = options.signupBarrier ?? 0;
  const hashed = signal();
  const mailer = memoryMailer();
  const app = createApp({
    mailer,
    db, serverSecret: TEST_SECRET, appOrigin: TEST_ORIGIN,
    media: { put: async () => ({ pathname: 'synthetic.jpg' }), del: async () => {} },
    limits: options.signupGlobalMax === undefined ? undefined : { signupGlobal: { max: options.signupGlobalMax, windowSec: 3600 } },
    passwords: {
      hash: async (p) => {
        const held = pauseHash;
        pauseHash = undefined;
        const hash = await scryptHasher.hash(p);
        if (held) {
          held.reached.resolve();
          await held.resume.promise;
        }
        if (hashing > 0) {
          hashing--;
          if (hashing === 0) hashed.resolve();
          await hashed.promise;
        }
        return hash;
      },
      verify: async (p, hash) => {
        const held = pause;
        pause = undefined;
        const ok = await scryptHasher.verify(p, hash);
        if (held) {
          held.reached.resolve();
          await held.resume.promise;
        }
        return ok;
      },
    },
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP test server');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    agent: () => new Agent(url),
    async resetToken(email: string) {
      const result = await new Agent(url).post('/api/auth/forgot-password', { email });
      assert.equal(result.status, 200);
      const link = mailer.sent[mailer.sent.length - 1]?.link;
      assert.ok(link);
      return new URLSearchParams(new URL(link).hash.slice(1)).get('token');
    },
    db,
    pauseHashing() {
      const held = { reached: signal(), resume: signal() };
      pauseHash = held;
      return held;
    },
    pauseVerification() {
      const held = { reached: signal(), resume: signal() };
      pause = held;
      return held;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    },
  };
}

test('SEC-01: old password login cannot authenticate after a completed reset', { timeout: 20_000 }, async () => {
  const app = await raceApp();
  const held = app.pauseVerification();
  try {
    const member = await signUp(app.agent());
    const attacker = app.agent();
    const login = attacker.post('/api/auth/login', { email: member.email, password: member.password });
    await held.reached.promise;
    const resetter = app.agent();
    const reset = await resetter.post('/api/auth/reset', {
      token: await app.resetToken(member.email), newPassword: 'new synthetic password',
    });
    assert.equal(reset.status, 200);
    held.resume.resolve();
    assert.equal((await login).status, 401);
    assert.equal((await attacker.get<MeResponse>('/api/me')).body.user, null);
    assert.equal((await resetter.get<MeResponse>('/api/me')).body.user, null);
  } finally {
    held.resume.resolve();
    await app.close();
  }
});

test('SEC-04: concurrent signups compete for the last global slot atomically', { timeout: 20_000 }, async () => {
  const app = await raceApp({ signupBarrier: 4, signupGlobalMax: 1 });
  try {
    const requests = Array.from({ length: 4 }, () => ({ agent: app.agent(), email: uniqueEmail() }));
    const results = await Promise.all(requests.map(({ agent, email }) => agent.post('/api/auth/signup', {
      email, password: 'synthetic signup password',
    })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 429, 429, 429]);
    for (let i = 0; i < requests.length; i++) {
      const { agent, email } = requests[i];
      const me = await agent.get<MeResponse>('/api/me');
      if (results[i].status === 201) assert.ok(me.body.user);
      else {
        assert.equal(me.body.user, null);
        assert.equal((await app.agent().post('/api/auth/login', { email, password: 'synthetic signup password' })).status, 401);
      }
    }
  } finally {
    await app.close();
  }
});

test('SEC-04: refused signups do not consume capacity and a full cap skips scrypt', async () => {
  const app = await makeTestApp({ limits: { signupGlobal: { max: 2, windowSec: 3600 } } });
  try {
    const first = await signUp(app.agent());
    assert.equal((await app.agent().post('/api/auth/signup', { email: first.email, password: first.password })).status, 409);
    await signUp(app.agent());
    const hashes = app.scrypt.hash;
    assert.equal((await app.agent().post('/api/auth/signup', { email: uniqueEmail(), password: first.password })).status, 429);
    assert.equal(app.scrypt.hash, hashes);
  } finally {
    await app.close();
  }
});

for (const operation of ['login', 'password', 'delete account'] as const) {
  for (const change of ['reset', 'password'] as const) {
    if (operation === 'login' && change === 'reset') continue;
    test(`SEC-01: stale ${operation} fails after a completed ${change}`, { timeout: 20_000 }, async () => {
      const app = await raceApp();
      let held: ReturnType<typeof app.pauseVerification> | undefined;
      try {
        const member = await signUp(app.agent());
        held = app.pauseVerification();
        const staleAgent = operation === 'login' ? app.agent() : member.agent;
        const body = operation === 'login' ? { email: member.email, password: member.password }
          : operation === 'password' ? { currentPassword: member.password, newPassword: 'stale request password' }
            : { password: member.password };
        const stale = staleAgent.post(operation === 'delete account' ? '/api/me/delete' : `/api/auth/${operation}`, body);
        await held.reached.promise;
        const changer = change === 'reset' ? app.agent() : member.agent;
        if (change === 'reset') {
          const changed = await changer.post('/api/auth/reset', {
            token: await app.resetToken(member.email), newPassword: 'winning new password',
          });
          assert.equal(changed.status, 200);
        } else {
          const changed = await changer.post<AuthResponse>('/api/auth/password', {
            currentPassword: member.password, newPassword: 'winning new password',
          });
          assert.equal(changed.status, 200);
        }
        held.resume.resolve();
        assert.equal((await stale).status, 401);
        if (operation === 'login') assert.equal((await staleAgent.get<MeResponse>('/api/me')).body.user, null);
        assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password: 'winning new password' })).status, 200);
      } finally {
        held?.resume.resolve();
        await app.close();
      }
    });
  }
}

for (const competing of ['new link', 'password change', 'expiry'] as const) {
  test(`SEC-01: pending reset fails after ${competing} during password hashing`, { timeout: 20_000 }, async () => {
    const app = await raceApp();
    let held: ReturnType<typeof app.pauseHashing> | undefined;
    try {
      const member = await signUp(app.agent());
      const token = await app.resetToken(member.email);
      held = app.pauseHashing();
      const stale = app.agent().post('/api/auth/reset', { token, newPassword: 'stale synthetic password' });
      await held.reached.promise;
      if (competing === 'new link') await app.resetToken(member.email);
      else if (competing === 'password change') {
        assert.equal((await member.agent.post('/api/auth/password', {
          currentPassword: member.password, newPassword: 'winning synthetic password',
        })).status, 200);
      } else {
        await app.db.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second'");
      }
      held.resume.resolve();
      assert.equal((await stale).status, 401);
      const password = competing === 'password change' ? 'winning synthetic password' : member.password;
      assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password })).status, 200);
    } finally {
      held?.resume.resolve();
      await app.close();
    }
  });
}

test('SEC-01: two simultaneous resets consume a link only once', { timeout: 20_000 }, async () => {
  const app = await raceApp();
  let held: ReturnType<typeof app.pauseHashing> | undefined;
  try {
    const member = await signUp(app.agent());
    const token = await app.resetToken(member.email);
    held = app.pauseHashing();
    const first = app.agent().post('/api/auth/reset', { token, newPassword: 'stale synthetic password' });
    await held.reached.promise;
    const second = await app.agent().post('/api/auth/reset', { token, newPassword: 'winning synthetic password' });
    assert.equal(second.status, 200);
    held.resume.resolve();
    assert.equal((await first).status, 401);
    assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password: 'winning synthetic password' })).status, 200);
    assert.equal((await app.agent().post('/api/auth/login', { email: member.email, password: 'stale synthetic password' })).status, 401);
  } finally {
    held?.resume.resolve();
    await app.close();
  }
});
