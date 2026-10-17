// Keys, hashing and random codes. Spec section 5.
import { createHash, createHmac, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

export interface Keys {
  /** HMAC key for email_hmac. */
  email: Buffer;
  /** HMAC key for stored recovery codes. */
  recovery: Buffer;
  /** HMAC key for daily IP keys used by rate limits. Raw IPs are never stored. */
  ip: Buffer;
}

export function deriveKeys(serverSecret: string): Keys {
  if (!serverSecret || Buffer.byteLength(serverSecret) < 32) {
    throw new Error('SERVER_SECRET must be at least 32 bytes');
  }
  const sub = (info: string) => Buffer.from(hkdfSync('sha256', serverSecret, 'veganway-dxb-v2', info, 32));
  return { email: sub('email'), recovery: sub('recovery'), ip: sub('ip') };
}

export function hmac(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailHmac(keys: Keys, email: string): string {
  return hmac(keys.email, normalizeEmail(email));
}

/**
 * The part of an address that names one client. IPv4: the full address. IPv6: the /64 prefix,
 * because one home or phone usually holds a whole /64 and can rotate through it at will.
 * IPv4 mapped IPv6 (::ffff:1.2.3.4) counts as IPv4. Anything else is used as it is.
 */
export function ipBucket(ip: string): string {
  const addr = ip.trim().replace(/%.*$/, '').toLowerCase();
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (isIPv4(addr) || !isIPv6(addr)) return addr;
  const [head, tail = ''] = addr.split('::');
  const left = head ? head.split(':') : [];
  const right = addr.includes('::') ? (tail ? tail.split(':') : []) : [];
  // A trailing embedded IPv4 takes two groups; it is never inside the first four.
  const width = (g: string[]) => g.reduce((n, x) => n + (x.includes('.') ? 2 : 1), 0);
  const groups = [...left, ...Array<string>(Math.max(0, 8 - width(left) - width(right))).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** Daily IP key: HMAC(subkey, UTC date + client bucket). Rotates every day, never reversible to the IP. */
export function ipKey(keys: Keys, ip: string, now = new Date()): string {
  return hmac(keys.ip, `${now.toISOString().slice(0, 10)}|${ipBucket(ip)}`);
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Passwords: async scrypt, N=2^15, r=8, p=1, 16 byte salt. Never scryptSync (shared instances).
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export const scryptHasher: PasswordHasher = {
  async hash(password) {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt);
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
  },
  async verify(password, stored) {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, keyB64] = parts;
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  },
};

// Recovery codes: 20 Crockford base32 characters (100 bits), shown as 5 groups of 4.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newRecoveryCode(): string {
  const bytes = randomBytes(20);
  let out = '';
  for (const b of bytes) out += CROCKFORD[b & 31];
  return out;
}

export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** Accepts any spacing, hyphens and case; maps the Crockford look alikes I, L to 1 and O to 0. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

export function isRecoveryCodeShape(code: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(code);
}

export function recoveryHash(keys: Keys, code: string): string {
  return hmac(keys.recovery, normalizeRecoveryCode(code));
}
