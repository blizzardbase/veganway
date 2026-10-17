// Runs from `npm run vercel-build`. Only a production build migrates DATABASE_URL.
// Preview and development builds see the same DATABASE_URL on Vercel, so migrating there would change
// the production schema from an unreviewed branch. They exit 0 and touch nothing.
import { createDb } from '../db.js';
import { migrate } from '../migrate.js';
import { resetForLaunch, seedWelcome } from './launch.js';
import { runAdminCommand } from './admin.js';

async function main() {
  const target = process.env.VERCEL_ENV;
  if (target !== 'production') {
    console.log(`Skipping migrations: VERCEL_ENV is ${target ? `"${target}"` : 'not set'}. Only production builds migrate.`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const db = createDb({ url });
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply.');
    if (process.env.VW_LAUNCH_RESET === '1') {
      const { removedAccounts } = await resetForLaunch(db);
      console.log(`Launch reset: removed ${removedAccounts} test accounts and all content.`);
    }
    // Admin grants by pseudonym, comma separated, because only a production build can reach the
    // database. Remove the variable after the deploy; a repeat grant is harmless.
    for (const pseudonym of (process.env.VW_GRANT_ADMIN_PSEUDONYMS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      try {
        const who = await runAdminCommand(db, process.env.SERVER_SECRET ?? '', { action: 'grant', pseudonym });
        console.log(`Admin granted: ${who}`);
      } catch (err) {
        console.error(`Admin grant failed for one pseudonym: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
    if (process.env.VW_LAUNCH_SEED === '1') {
      const { created } = await seedWelcome(db);
      console.log(created ? `Launch seed: added ${created} welcome topics.` : 'Launch seed: welcome topics already present.');
    }
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err instanceof Error ? err.name : 'unknown error');
  process.exit(1);
});
