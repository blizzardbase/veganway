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
import { emailHmac, ipKey, normalizeEmail, randomToken, sha256 } from '../lib/crypto.js';
import { setTimeout as delay } from 'node:timers/promises';
import { resetMail } from '../lib/mailer.js';
import { fail, parse } from '../lib/http.js';
import { availablePseudonym } from '../lib/pseudonym.js';
import { check, limit } from '../lib/rate.js';
import { PASSWORD_MAX, PASSWORD_MIN, type AuthResponse, type MeResponse } from '../../shared/types.js';

const email = z.string({ error: 'Enter your email address.' }).trim().min(3, { error: 'Enter your email address.' })
  .max(254, { error: 'That email address is too long.' })
  .pipe(z.email({ error: 'Enter a valid email address.' }));
const newPassword = z.string({ error: 'Choose a password.' })
  .min(PASSWORD_MIN, { error: `Use at least ${PASSWORD_MIN} characters.` })
  .max(PASSWORD_MAX, { error: `Use at most ${PASSWORD_MAX} characters.` });
const anyPassword = z.string({ error: 'Enter your password.' }).min(1, { error: 'Enter your password.' })
  .max(PASSWORD_MAX, { error: 'Email or password is wrong.' });
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'That reset link is not valid. Request a new link.' });

const signupBody = z.object({ email, password: newPassword });
const loginBody = z.object({ email, password: anyPassword });
const forgotBody = z.object({ email });
const resetBody = z.object({ token, newPassword });
const changeBody = z.object({ currentPassword: anyPassword, newPassword });

const RESET_RESPONSE_MS = 5500;
const RESET_DELIVERY_MS = 5000;

const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

interface Credentials { id: string; pw_hash: string }

// Hold the account lock until the session or credential write commits. Scrypt stays outside it.
async function credentialsCurrent(q: Queryable, row: Credentials): Promise<boolean> {
  return Boolean(await q.maybeOne(
    `SELECT id FROM users WHERE id = $1 AND pw_hash = $2
     AND banned_at IS NULL AND deleted_at IS NULL AND NOT is_system FOR UPDATE`,
    [row.id, row.pw_hash],
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
      fail(409, 'An account already uses this email. Sign in, or request a password reset link.', 'email_taken', 'email');
    }
    const pwHash = await passwords.hash(body.password);
    for (let attempt = 0; attempt < 3; attempt++) {
      const pseudonym = await availablePseudonym(db);
      try {
        const out = await db.tx(async (q) => {
          const row = await q.one<{ id: string }>(
            'INSERT INTO users (email_hmac, pw_hash, pseudonym) VALUES ($1, $2, $3) RETURNING id',
            [emailH, pwHash, pseudonym],
          );
          // The atomic counter also enforces capacity here. A full cap rolls back the insert.
          await limit(q, 'signup:global', limits.signupGlobal);
          const session = await createSession(q, row.id);
          const user = await q.one<Parameters<typeof toSessionUser>[0]>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [row.id]);
          return { user: toSessionUser(user), ...session };
        });
        setSessionCookie(deps, res, out.token);
        const response: AuthResponse = { user: toMe(out.user), csrf: out.csrf };
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
      'SELECT id, pw_hash, banned_at FROM users WHERE email_hmac = $1 AND deleted_at IS NULL AND NOT is_system',
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

  r.post('/auth/forgot-password', async (req, res) => {
    const body = parse(forgotBody, req.body);
    const emailH = emailHmac(keys, body.email);
    await limit(db, `reset:ip:${ipKey(keys, clientIp(req))}`, limits.resetIp);
    await limit(db, `reset:email:${emailH}`, limits.resetEmail);
    if (!deps.mailer.configured) {
      console.error('password_reset_mailer_unconfigured');
      fail(503, 'Password reset is not available right now. Try again later.', 'reset_unavailable');
    }
    // Both account cases run the same statements, generate a token, and share a response deadline.
    // Delivery has a shorter deadline so provider latency or failure cannot reveal membership.
    const started = performance.now();
    const raw = randomToken(32);
    try {
      const userId = await db.tx(async (q) => {
        const user = await q.maybeOne<{ id: string }>(
          `SELECT id FROM users WHERE email_hmac = $1 AND banned_at IS NULL
           AND deleted_at IS NULL AND NOT is_system FOR UPDATE`, [emailH],
        );
        const id = user?.id ?? '00000000-0000-0000-0000-000000000000';
        await q.query('DELETE FROM password_reset_tokens WHERE expires_at < now()');
        await q.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [id]);
        await q.query(
          `INSERT INTO password_reset_tokens (token_hash, user_id)
           SELECT $1, id FROM users WHERE id = $2 AND banned_at IS NULL AND deleted_at IS NULL AND NOT is_system`,
          [sha256(raw), id],
        );
        return user?.id;
      });
      if (userId) {
        const link = new URL('/reset', deps.config.origin);
        // The fragment never reaches the server, so the token stays out of request logs.
        link.hash = new URLSearchParams({ token: raw }).toString();
        const remaining = Math.max(1, Math.floor(RESET_DELIVERY_MS - (performance.now() - started)));
        const signal = AbortSignal.timeout(remaining);
        // Race as well as abort: a broken adapter must not extend the public response deadline.
        await Promise.race([
          deps.mailer.send(resetMail(normalizeEmail(body.email), link.href), signal),
          delay(remaining, undefined, { signal }).then(() => { throw new Error('ResetMailTimeout'); }),
        ]);
      }
    } catch {
      console.error('password_reset_delivery_failed');
    } finally {
      await delay(Math.max(0, RESET_RESPONSE_MS - (performance.now() - started)));
    }
    res.json({ message: 'If an account uses this email, we have sent a reset link. It works for 30 minutes.' });
  });

  r.post('/auth/reset', async (req, res) => {
    const body = parse(resetBody, req.body);
    await limit(db, `reset-token:ip:${ipKey(keys, clientIp(req))}`, limits.resetIp);
    const hash = sha256(body.token);
    const candidate = await db.maybeOne<Credentials>(
      `SELECT u.id, u.pw_hash FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
       AND u.banned_at IS NULL AND u.deleted_at IS NULL AND NOT u.is_system`, [hash],
    );
    if (!candidate) fail(401, 'That reset link is invalid or has expired. Request a new link.', 'bad_reset');
    const pwHash = await passwords.hash(body.newPassword);
    await db.tx(async (q) => {
      if (!(await credentialsCurrent(q, candidate))) fail(401, 'That reset link is invalid or has expired. Request a new link.', 'bad_reset');
      // Lock the account first, then recheck token use and expiry after any competing writer.
      const consumed = await q.maybeOne(
        `UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1
         AND user_id = $2 AND used_at IS NULL AND expires_at > clock_timestamp() RETURNING user_id`,
        [hash, candidate.id],
      );
      if (!consumed) fail(401, 'That reset link is invalid or has expired. Request a new link.', 'bad_reset');
      await q.query('UPDATE users SET pw_hash = $1 WHERE id = $2', [pwHash, candidate.id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1', [candidate.id]);
      await q.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [candidate.id]);
      await audit(q, { actorId: candidate.id, action: 'auth.reset', targetType: 'user', targetId: candidate.id });
    });
    clearSessionCookie(deps, res);
    res.json({ message: 'Password changed. Sign in with your new password.' });
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
    const row = await db.one<Credentials>('SELECT id, pw_hash FROM users WHERE id = $1', [me.id]);
    if (!(await passwords.verify(body.currentPassword, row.pw_hash))) fail(401, 'Your current password is wrong.', 'bad_credentials', 'currentPassword');
    const pwHash = await passwords.hash(body.newPassword);
    const session = res.locals.session!;
    await db.tx(async (q) => {
      if (!(await credentialsCurrent(q, row))) fail(401, 'Your current password is wrong.', 'bad_credentials', 'currentPassword');
      await q.query('UPDATE users SET pw_hash = $1 WHERE id = $2', [pwHash, me.id]);
      await q.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [me.id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [me.id, session.tokenHash]);
      await audit(q, { actorId: me.id, action: 'auth.password_change', targetType: 'user', targetId: me.id });
    });
    const response: AuthResponse = { user: toMe(me), csrf: session.csrf };
    res.json(response);
  });

  return r;
}
