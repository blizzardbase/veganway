// Vercel function entry. vercel.json rewrites /api/(.*) here; Express sees the original path.
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { resendMailer } from '../server/lib/mailer.js';
import { blobMediaStore } from '../server/lib/media.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const db = createDb({ url: requireEnv('DATABASE_URL') });

export default createApp({
  db,
  mailer: resendMailer({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM }),
  serverSecret: requireEnv('SERVER_SECRET'),
  appOrigin: requireEnv('APP_ORIGIN'),
  media: blobMediaStore(requireEnv('BLOB_READ_WRITE_TOKEN')),
  // Vercel's edge sets X-Forwarded-For itself; trust exactly one hop.
  trustProxy: 1,
});
