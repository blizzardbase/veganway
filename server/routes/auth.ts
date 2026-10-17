// Accounts, complete. Spec section 5.
// Owns: GET /api/me (exact path only) and everything under /api/auth.
// The me slice owns /api/me/<anything else> in server/routes/me.ts.
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { isUniqueViolation, type Queryable } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  clearSessionCookie, createSession, currentUser, loadUser, requireUser, setSessionCookie, toMe, toSessionUser, USER_COLUMNS,
} from '../lib/auth.js';
import {
  emailHmac, formatRecoveryCode, ipKey, isRecoveryCodeShape, newRecoveryCode, normalizeRecoveryCode,
  randomToken, recoveryHash, safeEqualHex, hmac,
} from '../lib/crypto.js';
import { fail, parse } from '../lib/http.js';
import { availablePseudonym } from '../lib/pseudonym.js';
import { check, limit } from '../lib/rate.js';
import { PASSWORD_MAX, PASSWORD_MIN, type AccountWithCodeResponse, type AuthResponse, type MeResponse, type RecoveryCodeResponse } from '../../shared/types.js';

const email = z.string({ error: 'Enter your email address.' }).trim().min(3, { error: 'Enter your email address.' })
  .max(254, { error: 'That email address is too long.' })
  .pipe(z.email({ error: 'Enter a valid email address.' }));
const newPassword = z.string({ error: 'Choose a password.' })
  .min(PASSWORD_MIN, { error: `Use at least ${PASSWORD_MIN} characters.` })
  .max(PASSWORD_MAX, { error: `Use at most ${PASSWORD_MAX} characters.` });
const anyPassword = z.string({ error: 'Enter your password.' }).min(1, { error: 'Enter your password.' })
  .max(PASSWORD_MAX, { error: 'Email or password is wrong.' });
const recoveryCode = z.string({ error: 'Enter your recovery code.' }).max(64, { error: 'That recovery code is not valid.' });

const signupBody = z.object({ email, password: newPassword });
const loginBody = z.object({ email, password: anyPassword });
const resetBody = z.object({ email, recoveryCode, newPassword });
const changeBody = z.object({ currentPassword: anyPassword, newPassword });
const passwordOnly = z.object({ password: anyPassword });

const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

interface Credentials { id: string; pw_hash: string; recovery_hash: string }

// Hold the account lock until the session or credential write commits. Scrypt stays outside it.
async function credentialsCurrent(q: Queryable, row: Credentials): Promise<boolean> {
  return Boolean(await q.maybeOne(
    `SELECT id FROM users WHERE id = $1 AND pw_hash = $2 AND recovery_hash = $3
     AND banned_at IS NULL AND deleted_at IS NULL AND NOT is_system FOR UPDATE`,
    [row.id, row.pw_hash, row.recovery_hash],
  ));
}

export function router(deps: Deps): Router {
  const r = Router();
  const { db, keys, passwords, limits } = deps;

  // A fixed scrypt hash so an unknown email costs the same time as a real one.
  let dummyHash: Promise<string> | null = null;
  const dummy = () => (dummyHash ??= passwords.hash(randomToken(16)));

  r.get('/me', (_req, res) => {
    const s = res.locals.session;
    const body: MeResponse = { user: s ? toMe(s.user) : null, csrf: s?.csrf ?? null };
    res.json(body);
  });

  r.post('/auth/signup', async (req, res) => {
    const body = parse(signupBody, req.body);
    const ipk = ipKey(keys, clientIp(req));
    // The per IP limit counts every attempt before scrypt. The global limit counts only accounts
    // created (below, after the INSERT), so refused attempts cannot lock everyone out.
    await limit(db, `signup:ip:${ipk}`, limits.signupIp);
    await check(db, 'signup:global', limits.signupGlobal);
    const emailH = emailHmac(keys, body.email);
    if (await db.maybeOne('SELECT 1 FROM users WHERE email_hmac = $1', [emailH])) {
      fail(409, 'An account already uses this email. Sign in, or reset your password with your recovery code.', 'email_taken', 'email');
    }
    const pwHash = await passwords.hash(body.password);
    const code = newRecoveryCode();
    for (let attempt = 0; attempt < 3; attempt++) {
      const pseudonym = await availablePseudonym(db);
      try {
        const out = await db.tx(async (q) => {
          const row = await q.one<{ id: string }>(
            'INSERT INTO users (email_hmac, pw_hash, recovery_hash, pseudonym) VALUES ($1, $2, $3, $4) RETURNING id',
            [emailH, pwHash, recoveryHash(keys, code), pseudonym],
          );
          // The atomic counter also enforces capacity here. A full cap rolls back the insert.
          await limit(q, 'signup:global', limits.signupGlobal);
          const session = await createSession(q, row.id);
          const user = await q.one<Parameters<typeof toSessionUser>[0]>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [row.id]);
          return { user: toSessionUser(user), ...session };
        });
        setSessionCookie(deps, res, out.token);
        const response: AccountWithCodeResponse = { user: toMe(out.user), csrf: out.csrf, recoveryCode: formatRecoveryCode(code) };
        res.status(201).json(response);
        return;
      } catch (err) {
        if (isUniqueViolation(err, 'users_email_hmac_key')) fail(409, 'An account already uses this email.', 'email_taken', 'email');
        if (!isUniqueViolation(err, 'users_pseudonym_key')) throw err;
      }
    }
    fail(503, 'Could not pick a name. Please try again.');
  });

  r.post('/auth/login', async (req, res) => {
    const body = parse(loginBody, req.body);
    const emailH = emailHmac(keys, body.email);
    // Both limits are counted before any scrypt work.
    await limit(db, `login:email:${emailH}`, limits.loginEmail);
    await limit(db, `login:ip:${ipKey(keys, clientIp(req))}`, limits.loginIp);
    const row = await db.maybeOne<Credentials & { banned_at: Date | null }>(
      'SELECT id, pw_hash, recovery_hash, banned_at FROM users WHERE email_hmac = $1 AND deleted_at IS NULL AND NOT is_system',
      [emailH],
    );
    const ok = await passwords.verify(body.password, row?.pw_hash ?? (await dummy()));
    if (!row || !ok) fail(401, 'Email or password is wrong.', 'bad_credentials');
    if (row.banned_at) fail(403, 'This account is suspended.', 'banned');
    const out = await db.tx(async (q) => {
      if (!(await credentialsCurrent(q, row))) fail(401, 'Email or password is wrong.', 'bad_credentials');
      const session = await createSession(q, row.id);
      const user = await loadUser(q, row.id);
      if (!user) fail(401, 'Email or password is wrong.', 'bad_credentials');
      return { user, ...session };
    });
    setSessionCookie(deps, res, out.token);
    const response: AuthResponse = { user: toMe(out.user), csrf: out.csrf };
    res.json(response);
  });

  r.post('/auth/logout', async (_req, res) => {
    const s = res.locals.session;
    if (s) await db.query('DELETE FROM sessions WHERE token_hash = $1', [s.tokenHash]);
    clearSessionCookie(deps, res);
    res.json({ ok: true });
  });

  // Reset = email + recovery code + new password. No email is ever sent.
  r.post('/auth/reset', async (req, res) => {
    const body = parse(resetBody, req.body);
    const emailH = emailHmac(keys, body.email);
    await limit(db, `reset:email:${emailH}`, limits.resetEmail);
    await limit(db, `reset:ip:${ipKey(keys, clientIp(req))}`, limits.resetIp);
    const code = normalizeRecoveryCode(body.recoveryCode);
    const row = await db.maybeOne<{ id: string; recovery_hash: string; banned_at: Date | null }>(
      'SELECT id, recovery_hash, banned_at FROM users WHERE email_hmac = $1 AND deleted_at IS NULL AND NOT is_system',
      [emailH],
    );
    // Hash the new password before deciding, so a wrong email and a wrong code take the same time.
    const pwHash = await passwords.hash(body.newPassword);
    const given = recoveryHash(keys, code);
    const matches = isRecoveryCodeShape(code) && safeEqualHex(given, row?.recovery_hash ?? hmac(keys.recovery, randomToken(8)));
    if (!row || !matches) fail(401, 'Email or recovery code is wrong.', 'bad_recovery');
    if (row.banned_at) fail(403, 'This account is suspended.', 'banned');
    const next = newRecoveryCode();
    const out = await db.tx(async (q) => {
      // Consume the code atomically: a second reset with the same code finds no row.
      const updated = await q.maybeOne<{ id: string }>(
        'UPDATE users SET pw_hash = $1, recovery_hash = $2 WHERE id = $3 AND recovery_hash = $4 RETURNING id',
        [pwHash, recoveryHash(keys, next), row.id, given],
      );
      if (!updated) fail(401, 'Email or recovery code is wrong.', 'bad_recovery');
      await q.query('DELETE FROM sessions WHERE user_id = $1', [row.id]);
      await audit(q, { actorId: row.id, action: 'auth.reset', targetType: 'user', targetId: row.id });
      const session = await createSession(q, row.id);
      const user = await loadUser(q, row.id);
      if (!user) fail(401, 'Email or recovery code is wrong.', 'bad_recovery');
      return { user, ...session };
    });
    setSessionCookie(deps, res, out.token);
    const response: AccountWithCodeResponse = { user: toMe(out.user), csrf: out.csrf, recoveryCode: formatRecoveryCode(next) };
    res.json(response);
  });

  // Shuffle the assigned pseudonym. Allowed only until the member confirms it.
  r.post('/auth/shuffle', requireUser, async (_req, res) => {
    const me = currentUser(res);
    if (me.pseudonymConfirmed) fail(409, 'Your name is already set. You can add a display name in Me.', 'pseudonym_confirmed');
    await limit(db, `shuffle:${me.id}`, limits.shuffle);
    for (let attempt = 0; attempt < 3; attempt++) {
      const name = await availablePseudonym(db, me.pseudonym);
      try {
        await db.query('UPDATE users SET pseudonym = $1 WHERE id = $2 AND pseudonym_confirmed_at IS NULL', [name, me.id]);
        break;
      } catch (err) {
        if (!isUniqueViolation(err, 'users_pseudonym_key')) throw err;
      }
    }
    const user = await loadUser(db, me.id);
    if (!user) fail(401, 'Please sign in first.', 'signed_out');
    const response: AuthResponse = { user: toMe(user), csrf: res.locals.session!.csrf };
    res.json(response);
  });

  r.post('/auth/confirm-pseudonym', requireUser, async (_req, res) => {
    const me = currentUser(res);
    await db.query('UPDATE users SET pseudonym_confirmed_at = coalesce(pseudonym_confirmed_at, now()) WHERE id = $1', [me.id]);
    const user = await loadUser(db, me.id);
    if (!user) fail(401, 'Please sign in first.', 'signed_out');
    const response: AuthResponse = { user: toMe(user), csrf: res.locals.session!.csrf };
    res.json(response);
  });

  // Change password while signed in. Other sessions end; this one stays.
  r.post('/auth/password', requireUser, async (req, res) => {
    const me = currentUser(res);
    const body = parse(changeBody, req.body);
    await limit(db, `password:${me.id}`, limits.passwordChange);
    const row = await db.one<Credentials>('SELECT id, pw_hash, recovery_hash FROM users WHERE id = $1', [me.id]);
    if (!(await passwords.verify(body.currentPassword, row.pw_hash))) fail(401, 'Your current password is wrong.', 'bad_credentials', 'currentPassword');
    const pwHash = await passwords.hash(body.newPassword);
    const session = res.locals.session!;
    await db.tx(async (q) => {
      if (!(await credentialsCurrent(q, row))) fail(401, 'Your current password is wrong.', 'bad_credentials', 'currentPassword');
      await q.query('UPDATE users SET pw_hash = $1 WHERE id = $2', [pwHash, me.id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [me.id, session.tokenHash]);
      await audit(q, { actorId: me.id, action: 'auth.password_change', targetType: 'user', targetId: me.id });
    });
    const response: AuthResponse = { user: toMe(me), csrf: session.csrf };
    res.json(response);
  });

  // Issue a fresh recovery code while signed in (for a member who lost the first one). Needs the password.
  r.post('/auth/recovery-code', requireUser, async (req, res) => {
    const me = currentUser(res);
    const body = parse(passwordOnly, req.body);
    await limit(db, `password:${me.id}`, limits.passwordChange);
    const row = await db.one<Credentials>('SELECT id, pw_hash, recovery_hash FROM users WHERE id = $1', [me.id]);
    if (!(await passwords.verify(body.password, row.pw_hash))) fail(401, 'Your password is wrong.', 'bad_credentials', 'password');
    const next = newRecoveryCode();
    await db.tx(async (q) => {
      if (!(await credentialsCurrent(q, row))) fail(401, 'Your password is wrong.', 'bad_credentials', 'password');
      await q.query('UPDATE users SET recovery_hash = $1 WHERE id = $2', [recoveryHash(keys, next), me.id]);
      await audit(q, { actorId: me.id, action: 'auth.recovery_code_reissued', targetType: 'user', targetId: me.id });
    });
    const response: RecoveryCodeResponse = { recoveryCode: formatRecoveryCode(next) };
    res.json(response);
  });

  return r;
}
