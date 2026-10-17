// Photo storage. Production: Vercel Blob public store, served same origin via the /media rewrite.
// Local dev and tests: files under data/media, served by server/dev.ts at /media.
// The photos slice owns validation, EXIF stripping and the photos table; this file only stores bytes.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { del, put } from '@vercel/blob';

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
export async function deleteMedia(store: MediaStore, pathnames: string[]): Promise<void> {
  for (const pathname of pathnames) {
    try {
      await store.del(pathname);
    } catch (err) {
      console.error('media_delete_failed', err instanceof Error ? err.name : 'Error');
    }
  }
}
