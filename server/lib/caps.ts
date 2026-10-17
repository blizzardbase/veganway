// Daily content caps (spec section 5). Accounts under 24 hours old get the lower numbers.
// "Daily" means the last 24 hours, rolling.
import type { Queryable } from '../db.js';
import { fail } from './http.js';
import type { SessionUser } from './auth.js';

export type CapKind = 'listing' | 'post' | 'photo';

export const CAPS: Record<CapKind, { fresh: number; established: number }> = {
  listing: { fresh: 5, established: 20 },
  // Recommendations and replies share one cap.
  post: { fresh: 20, established: 100 },
  photo: { fresh: 10, established: 30 },
};

const COUNT_SQL: Record<CapKind, string> = {
  listing: `SELECT count(*) AS n FROM listings WHERE created_by = $1 AND created_at > now() - interval '24 hours'`,
  post: `SELECT (SELECT count(*) FROM recommendations WHERE user_id = $1 AND created_at > now() - interval '24 hours')
              + (SELECT count(*) FROM replies WHERE user_id = $1 AND created_at > now() - interval '24 hours') AS n`,
  photo: `SELECT count(*) AS n FROM photos WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
};

export function isFreshAccount(user: Pick<SessionUser, 'createdAt'>, now = new Date()): boolean {
  return now.getTime() - user.createdAt.getTime() < 24 * 60 * 60 * 1000;
}

/**
 * Serialise one member's capped writes. Call it inside the transaction that inserts, before
 * counting: the lock holds until that transaction ends, so two parallel requests cannot both count
 * 19 and both insert the 20th. Outside a transaction it would release at once, so never call it there.
 */
export async function lockCaps(q: Queryable, userId: string): Promise<void> {
  await q.query(`SELECT pg_advisory_xact_lock(hashtext('caps:' || $1))`, [userId]);
}

/**
 * Throw 429 when creating one more item of this kind would pass the member's daily cap. Admins are exempt.
 * Run it inside the insert transaction: it takes the member's cap lock first (lockCaps).
 */
export async function checkCap(db: Queryable, user: SessionUser, kind: CapKind): Promise<void> {
  if (user.role === 'admin') return;
  await lockCaps(db, user.id);
  const cap = isFreshAccount(user) ? CAPS[kind].fresh : CAPS[kind].established;
  const { n } = await db.one<{ n: number }>(COUNT_SQL[kind], [user.id]);
  if (n >= cap) fail(429, `You have reached today's limit of ${cap}. Please try again tomorrow.`, 'daily_cap');
}
