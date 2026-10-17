// Grant or revoke the admin role. Audited. Never automatic.
//   npm run admin -- grant --email you@example.com
//   npm run admin -- revoke --pseudonym "Saffron Chickpea"
// Uses DATABASE_URL (or the local PGlite dev database) and SERVER_SECRET to hash the email.
// Stop `npm run dev` first when using the local PGlite database: it allows one process at a time.
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createDb, type Queryable } from '../db.js';
import { audit } from '../lib/audit.js';
import { deriveKeys, emailHmac } from '../lib/crypto.js';
import { databaseUrl, serverSecret } from '../env.js';

export interface AdminCommand {
  action: 'grant' | 'revoke';
  email?: string;
  pseudonym?: string;
}

export function parseAdminArgs(argv: string[]): AdminCommand {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { email: { type: 'string' }, pseudonym: { type: 'string' } },
  });
  const action = positionals[0];
  if (action !== 'grant' && action !== 'revoke') throw new Error('Usage: npm run admin -- grant|revoke --email <e> | --pseudonym <p>');
  if (Boolean(values.email) === Boolean(values.pseudonym)) throw new Error('Give exactly one of --email or --pseudonym');
  return { action, email: values.email, pseudonym: values.pseudonym };
}

/** Returns the pseudonym that changed. Throws when no active member matches. */
export async function runAdminCommand(db: Queryable, secret: string, cmd: AdminCommand): Promise<string> {
  const where = cmd.email ? 'email_hmac = $1' : 'lower(pseudonym) = lower($1)';
  const key = cmd.email ? emailHmac(deriveKeys(secret), cmd.email) : cmd.pseudonym!;
  const user = await db.maybeOne<{ id: string; pseudonym: string }>(
    `SELECT id, pseudonym FROM users WHERE ${where} AND NOT is_system AND deleted_at IS NULL`,
    [key],
  );
  if (!user) throw new Error('No member matches. Check the spelling, or that they have signed up.');
  const role = cmd.action === 'grant' ? 'admin' : 'member';
  await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);
  await audit(db, { actorId: null, action: `admin.${cmd.action}`, targetType: 'user', targetId: user.id, detail: { via: 'cli' } });
  return user.pseudonym;
}

async function main() {
  const cmd = parseAdminArgs(process.argv.slice(2));
  const db = createDb({ url: databaseUrl() });
  try {
    const name = await db.tx((q) => runAdminCommand(q, serverSecret(), cmd));
    console.log(`${cmd.action === 'grant' ? 'Granted admin to' : 'Revoked admin from'} ${name}.`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'Admin command failed');
    process.exit(1);
  });
}
