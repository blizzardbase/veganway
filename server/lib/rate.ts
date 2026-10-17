// Rate limits in the rate_limits table: one atomic upsert per check, run BEFORE any scrypt work.
import type { Queryable } from '../db.js';
import { fail } from './http.js';

export interface Rule {
  max: number;
  windowSec: number;
}

export const DEFAULT_LIMITS = {
  loginEmail: { max: 10, windowSec: 15 * 60 },
  loginIp: { max: 60, windowSec: 15 * 60 },
  signupIp: { max: 10, windowSec: 60 * 60 },
  // Counts accounts created, not attempts, so a flood of refused signups cannot lock everyone out.
  signupGlobal: { max: 600, windowSec: 60 * 60 },
  resetEmail: { max: 5, windowSec: 60 * 60 },
  resetIp: { max: 20, windowSec: 60 * 60 },
  shuffle: { max: 40, windowSec: 60 * 60 },
  passwordChange: { max: 10, windowSec: 15 * 60 },
} satisfies Record<string, Rule>;

export type Limits = { [K in keyof typeof DEFAULT_LIMITS]: Rule };

/** Count one hit against key. Returns the hit count in the current window. */
export async function hit(db: Queryable, key: string, rule: Rule): Promise<number> {
  const row = await db.one<{ hits: number }>(
    `INSERT INTO rate_limits (key, hits, expires_at)
     VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN rate_limits.expires_at < now() THEN 1 ELSE rate_limits.hits + 1 END,
       expires_at = CASE WHEN rate_limits.expires_at < now() THEN now() + make_interval(secs => $2) ELSE rate_limits.expires_at END
     RETURNING hits`,
    [key, rule.windowSec],
  );
  // Every window is at most an hour, and a row is deleted a day after it expires, on the next hit
  // of any key. That keeps the IP fingerprints the privacy page mentions for at most two days.
  await db.query(`DELETE FROM rate_limits WHERE expires_at < now() - interval '1 day'`);
  return row.hits;
}

/** Throw 429 when key has already used up its rule in the current window. Counts nothing. */
export async function check(db: Queryable, key: string, rule: Rule): Promise<void> {
  const row = await db.maybeOne<{ hits: number }>('SELECT hits FROM rate_limits WHERE key = $1 AND expires_at >= now()', [key]);
  if (row && row.hits >= rule.max) fail(429, 'Too many attempts. Please wait a while and try again.', 'rate_limited');
}

/** Count a hit and throw 429 when the rule is exceeded. */
export async function limit(db: Queryable, key: string, rule: Rule): Promise<void> {
  const hits = await hit(db, key, rule);
  if (hits > rule.max) fail(429, 'Too many attempts. Please wait a while and try again.', 'rate_limited');
}
