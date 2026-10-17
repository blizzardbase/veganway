// One time launch steps, run from the production build (server/cli/vercel-migrate.ts) only when
// their environment switch is set. Both are safe to run twice.
//   VW_LAUNCH_RESET=1  wipes test content before the public link goes out. It refuses when more than
//                      MAX_ACCOUNTS_FOR_RESET member accounts exist, so it can never erase a live community.
//   VW_LAUNCH_SEED=1   adds the pinned welcome topics, authored by the no login VeganWay system account,
//                      unless that account already has topics.
import type { Db } from '../db.js';

export const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001';
export const MAX_ACCOUNTS_FOR_RESET = 5;

const CONTENT_TABLES = [
  'audit', 'reports', 'claims', 'bookmarks', 'replies', 'poll_votes', 'poll_options', 'topics',
  'upvotes', 'opinions', 'recommendations', 'listings', 'media_deletions', 'photos', 'sessions', 'rate_limits',
];

export async function resetForLaunch(db: Db): Promise<{ removedAccounts: number }> {
  return db.tx(async (q) => {
    const { n } = await q.one<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE id <> $1', [SYSTEM_USER_ID]);
    if (n > MAX_ACCOUNTS_FOR_RESET) {
      throw new Error(`Launch reset refused: ${n} member accounts exist (limit ${MAX_ACCOUNTS_FOR_RESET}).`);
    }
    // users.avatar_photo_id references photos, and Postgres refuses TRUNCATE on any table another
    // table references, so clear the avatars and delete children before parents instead.
    await q.query('UPDATE users SET avatar_photo_id = NULL');
    for (const table of CONTENT_TABLES) await q.exec(`DELETE FROM ${table}`);
    await q.query('DELETE FROM users WHERE id <> $1', [SYSTEM_USER_ID]);
    return { removedAccounts: n };
  });
}

interface WelcomeTopic {
  kind: 'discussion' | 'poll';
  title: string;
  body: string;
  tags: string[];
  options?: string[];
  days?: number;
}

export const WELCOME_TOPICS: WelcomeTopic[] = [
  {
    kind: 'discussion',
    title: 'Welcome to VeganWay DXB. Start here',
    body:
      'This is a home for the vegan finds our WhatsApp group shares, so the good ones stop getting lost in the chat. ' +
      'Add a place or product you love, say what to order, post a deal, and vote on what others share. ' +
      'Your account has an anonymous name. No phone number, no tracking, and the code is open for anyone to check. ' +
      'Say hello below and tell us your favourite vegan spot in Dubai.',
    tags: ['welcome'],
  },
  {
    kind: 'discussion',
    title: 'Best vegan biryani in Dubai?',
    body: 'Fully vegan or a restaurant that does a proper vegan version. Name the place and what to ask for.',
    tags: ['biryani', 'indian'],
  },
  {
    kind: 'poll',
    title: 'Which area needs more vegan options?',
    body: 'Vote, then tell us in the replies which place you wish would open near you.',
    tags: ['areas'],
    options: ['Dubai Marina and JBR', 'JLT', 'Downtown and Business Bay', 'Deira and Bur Dubai', 'Al Barsha and Al Quoz', 'Jumeirah'],
    days: 14,
  },
  {
    kind: 'discussion',
    title: 'Home bakers and caterers: list your service here',
    body:
      'Bake, cook or run a vegan service? Add it from the plus button and choose Service, so members can find you and leave recommendations. ' +
      'Already listed by someone else? Open it and tap "This is my business" to claim it.',
    tags: ['services', 'bakers'],
  },
];

export async function seedWelcome(db: Db): Promise<{ created: number }> {
  return db.tx(async (q) => {
    const existing = await q.one<{ n: number }>('SELECT count(*)::int AS n FROM topics WHERE user_id = $1', [SYSTEM_USER_ID]);
    if (existing.n > 0) return { created: 0 };
    let created = 0;
    // Insert in reverse so the first topic is the newest and leads the pinned list.
    for (const [i, t] of WELCOME_TOPICS.map((t, i) => [i, t] as const).reverse()) {
      const row = await q.one<{ id: string }>(
        `INSERT INTO topics (user_id, kind, title, body, tags, pinned, closes_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $2 = 'poll' THEN now() + make_interval(days => $7::int) END,
                 now() - make_interval(secs => $8::int))
         RETURNING id`,
        [SYSTEM_USER_ID, t.kind, t.title, t.body, t.tags, i === 0 || i === 2, t.days ?? 7, i],
      );
      for (const [pos, label] of (t.options ?? []).entries()) {
        await q.query('INSERT INTO poll_options (topic_id, label, position) VALUES ($1, $2, $3)', [row.id, label, pos]);
      }
      created += 1;
    }
    return { created };
  });
}
