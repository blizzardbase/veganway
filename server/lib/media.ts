// Photo storage. Production: Vercel Blob public store, served same origin via the /media rewrite.
// Local dev and tests: files under data/media, served by server/dev.ts at /media.
// The photos slice owns validation and EXIF stripping; this file stores bytes and retries durable deletion work.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { del, put } from '@vercel/blob';
import type { Db } from '../db.js';

export interface MediaStore {
  /** Store bytes. A random suffix is always added; the returned pathname is what /media/<pathname> serves. */
  put(pathname: string, body: Buffer, contentType: string): Promise<{ pathname: string }>;
  /** Delete by the pathname returned from put. Deleting a missing file is not an error. */
  del(pathname: string): Promise<void>;
}

const SAFE = /^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]+$/;

function withSuffix(pathname: string): string {
  const dot = pathname.lastIndexOf('.');
  return `${pathname.slice(0, dot)}-${randomBytes(12).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}${pathname.slice(dot)}`;
}

export function fsMediaStore(dir: string): MediaStore {
  const resolve = (pathname: string) => {
    if (!SAFE.test(pathname)) throw new Error('Unsafe media pathname');
    const full = normalize(join(dir, pathname));
    if (!full.startsWith(normalize(dir) + sep)) throw new Error('Unsafe media pathname');
    return full;
  };
  return {
    async put(pathname, body) {
      const name = withSuffix(pathname);
      const full = resolve(name);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body);
      return { pathname: name };
    },
    async del(pathname) {
      await rm(resolve(pathname), { force: true });
    },
  };
}

export function blobMediaStore(token: string): MediaStore {
  return {
    async put(pathname, body, contentType) {
      if (!SAFE.test(pathname)) throw new Error('Unsafe media pathname');
      const result = await put(pathname, body, { access: 'public', addRandomSuffix: true, contentType, cacheControlMaxAge: 3600, token });
      return { pathname: result.pathname };
    },
    async del(pathname) {
      await del(pathname, { token });
    },
  };
}

/**
 * Delete stored bytes after the database change that hid them has committed. A failure never fails
 * the request: the row already says deleted_at, and the error name (never the path) is logged.
 */
export async function deleteMedia(store: MediaStore, pathnames: string[], db?: Db): Promise<void> {
  for (const pathname of pathnames) {
    let error: string | null = null;
    try { await store.del(pathname); }
    catch (err) {
      error = err instanceof Error ? err.name : 'Error';
      console.error('media_delete_failed', error);
    }
    if (db) await db.query(
      `UPDATE media_deletions SET attempts = attempts + 1, attempted_at = now(), last_error = $2,
         completed_at = CASE WHEN $2::text IS NULL THEN now() ELSE NULL END WHERE blob_path = $1`,
      [pathname, error]);
  }
}

const retries = new WeakMap<Db, Promise<void>>();

/** Retry at most ten failures after the response, with no transaction held during storage I/O. */
export function retryMediaDeletions(db: Db, store: MediaStore): Promise<void> {
  const running = retries.get(db);
  if (running) return running;
  const work = (async () => {
    try {
      const rows = await db.query<{ blob_path: string }>(
        `WITH pending AS (
           SELECT blob_path FROM media_deletions WHERE completed_at IS NULL
             AND (attempted_at IS NULL OR attempted_at < now() - interval '30 seconds')
           ORDER BY attempted_at NULLS FIRST, created_at, blob_path LIMIT 10 FOR UPDATE SKIP LOCKED
         ) UPDATE media_deletions d SET attempted_at = now() FROM pending p
           WHERE d.blob_path = p.blob_path RETURNING d.blob_path`);
      const bounded: MediaStore = { ...store, del: async (path) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            store.del(path),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DOMException('Storage timeout', 'TimeoutError')), 500); }),
          ]);
        } finally { clearTimeout(timer); }
      } };
      await deleteMedia(bounded, rows.map(row => row.blob_path), db);
    } catch (err) {
      console.error('media_retry_failed', err instanceof Error ? err.name : 'Error');
    }
  })().finally(() => { retries.delete(db); });
  retries.set(db, work);
  return work;
}
