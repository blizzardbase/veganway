// Sessions, the signed in user, and the requireUser and requireAdmin guards.
import type { NextFunction, Request, Response } from 'express';
import type { Queryable } from '../db.js';
import type { Deps } from '../deps.js';
import { randomToken, sha256 } from './crypto.js';
import { fail } from './http.js';
import type { Me } from '../../shared/types.js';

export interface SessionUser {
  id: string;
  pseudonym: string;
  pseudonymConfirmed: boolean;
  displayName: string | null;
  bio: string | null;
  avatarPhotoId: string | null;
  role: 'member' | 'admin';
  hasService: boolean;
  createdAt: Date;
}

export interface Session {
  user: SessionUser;
  csrf: string;
  tokenHash: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      session?: Session;
    }
  }
}

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  pseudonym: string;
  pseudonym_confirmed_at: Date | null;
  display_name: string | null;
  bio: string | null;
  avatar_photo_id: string | null;
  role: 'member' | 'admin';
  has_service: boolean;
  created_at: Date;
}

export const USER_COLUMNS = 'u.id, u.pseudonym, u.pseudonym_confirmed_at, u.display_name, u.bio, u.avatar_photo_id, u.role, u.has_service, u.created_at';

export function toSessionUser(r: UserRow): SessionUser {
  return {
    id: r.id,
    pseudonym: r.pseudonym,
    pseudonymConfirmed: r.pseudonym_confirmed_at !== null,
    displayName: r.display_name,
    bio: r.bio,
    avatarPhotoId: r.avatar_photo_id,
    role: r.role,
    hasService: r.has_service,
    createdAt: r.created_at,
  };
}

export function toMe(u: SessionUser): Me {
  return {
    id: u.id,
    pseudonym: u.pseudonym,
    pseudonymConfirmed: u.pseudonymConfirmed,
    displayName: u.displayName,
    bio: u.bio,
    avatarPhotoId: u.avatarPhotoId,
    role: u.role,
    hasService: u.hasService,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function loadUser(db: Queryable, id: string): Promise<SessionUser | null> {
  const row = await db.maybeOne<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1 AND u.banned_at IS NULL AND u.deleted_at IS NULL AND NOT u.is_system`,
    [id],
  );
  return row ? toSessionUser(row) : null;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Middleware: attaches res.locals.session when the cookie names a live session of an active member. */
export function loadSession(deps: Deps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, deps.config.cookieName);
    if (token && token.length <= 128) {
      const tokenHash = sha256(token);
      const row = await deps.db.maybeOne<UserRow & { csrf: string }>(
        `SELECT ${USER_COLUMNS}, s.csrf FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now() AND u.banned_at IS NULL AND u.deleted_at IS NULL AND NOT u.is_system`,
        [tokenHash],
      );
      if (row) res.locals.session = { user: toSessionUser(row), csrf: row.csrf, tokenHash };
    }
    next();
  };
}

/** Insert a session row. Inside a transaction, call setSessionCookie only after it commits. */
export async function createSession(db: Queryable, userId: string): Promise<{ token: string; csrf: string }> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [sha256(token), userId, csrf, SESSION_DAYS],
  );
  return { token, csrf };
}

export function setSessionCookie(deps: Deps, res: Response, token: string): void {
  res.cookie(deps.config.cookieName, token, {
    httpOnly: true,
    secure: deps.config.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MS,
  });
}

/** Create a session row and set the cookie. Returns the CSRF token for the client. Not for use inside tx. */
export async function startSession(deps: Deps, db: Queryable, res: Response, userId: string): Promise<string> {
  const { token, csrf } = await createSession(db, userId);
  setSessionCookie(deps, res, token);
  return csrf;
}

export function clearSessionCookie(deps: Deps, res: Response): void {
  res.clearCookie(deps.config.cookieName, { httpOnly: true, secure: deps.config.secure, sameSite: 'lax', path: '/' });
}

/** The signed in user, or a 401. Use inside handlers that sit behind requireUser. */
export function currentUser(res: Response): SessionUser {
  const s = res.locals.session;
  if (!s) fail(401, 'Please sign in first.', 'signed_out');
  return s.user;
}

export function requireUser(_req: Request, res: Response, next: NextFunction): void {
  if (!res.locals.session) {
    res.status(401).json({ error: 'Please sign in first.', code: 'signed_out' });
    return;
  }
  next();
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const s = res.locals.session;
  if (!s) {
    res.status(401).json({ error: 'Please sign in first.', code: 'signed_out' });
    return;
  }
  if (s.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.', code: 'not_admin' });
    return;
  }
  next();
}
