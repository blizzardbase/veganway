import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../../server/app.js';
import { createDb } from '../../server/db.js';
import { migrate } from '../../server/migrate.js';
import { scryptHasher } from '../../server/lib/crypto.js';
import { Agent, makeTestApp, signUp, uniqueEmail, TEST_ORIGIN, TEST_SECRET } from '../helpers.js';
import type { AccountWithCodeResponse, AuthResponse, MeResponse, RecoveryCodeResponse } from '../../shared/types.js';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function raceApp(options: { signupBarrier?: number; signupGlobalMax?: number } = {}) {
  const db = createDb({ url: 'pglite://memory' });
  await migrate(db);
  let pause: { reached: ReturnType<typeof signal>; resume: ReturnType<typeof signal> } | undefined;
  let hashing = options.signupBarrier ?? 0;
  const hashed = signal();
  const app = createApp({
    db, serverSecret: TEST_SECRET, appOrigin: TEST_ORIGIN,
    media: { put: async () => ({ pathname: 'synthetic.jpg' }), del: async () => {} },
    limits: options.signupGlobalMax === undefined ? undefined : { signupGlobal: { max: options.signupGlobalMax, windowSec: 3600 } },
    passwords: {
      hash: async (p) => {
        const hash = await scryptHasher.hash(p);
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
      email: member.email, recoveryCode: member.recoveryCode, newPassword: 'new synthetic password',
    });
    assert.equal(reset.status, 200);
    held.resume.resolve();
    assert.equal((await login).status, 401);
    assert.equal((await attacker.get<MeResponse>('/api/me')).body.user, null);
    assert.equal((await resetter.get<MeResponse>('/api/me')).body.user?.id, member.user.id);
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

for (const operation of ['login', 'password', 'recovery-code', 'delete account'] as const) {
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
        let recoveryCode = member.recoveryCode;
        if (change === 'reset') {
          const changed = await changer.post<AccountWithCodeResponse>('/api/auth/reset', {
            email: member.email, recoveryCode, newPassword: 'winning new password',
          });
          assert.equal(changed.status, 200);
          recoveryCode = changed.body.recoveryCode;
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
        // A stale recovery issuance must not replace the recovery code that just won.
        assert.equal((await app.agent().post('/api/auth/reset', {
          email: member.email, recoveryCode, newPassword: 'final synthetic password',
        })).status, 200);
      } finally {
        held?.resume.resolve();
        await app.close();
      }
    });
  }
}

test('SEC-01: an earlier recovery issuance cannot overwrite a newer recovery code', { timeout: 20_000 }, async () => {
  const app = await raceApp();
  let held: ReturnType<typeof app.pauseVerification> | undefined;
  try {
    const member = await signUp(app.agent());
    held = app.pauseVerification();
    const stale = member.agent.post('/api/auth/recovery-code', { password: member.password });
    await held.reached.promise;
    const fresh = await member.agent.post<RecoveryCodeResponse>('/api/auth/recovery-code', { password: member.password });
    assert.equal(fresh.status, 200);
    held.resume.resolve();
    assert.equal((await stale).status, 401);
    assert.equal((await app.agent().post('/api/auth/reset', {
      email: member.email, recoveryCode: fresh.body.recoveryCode, newPassword: 'new synthetic password',
    })).status, 200);
  } finally {
    held?.resume.resolve();
    await app.close();
  }
});
