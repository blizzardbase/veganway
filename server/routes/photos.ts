// Listings slice: photo upload. Mounted at /api. This router owns: POST /photos.
// The browser resizes to 1600 px and re encodes as JPEG before upload (src/features/listings/photo.ts).
// The server accepts only image/jpeg up to 2 MB and 4096 px a side, checks the FF D8 FF magic, strips metadata
// (server/lib/jpeg.ts), stores the bytes through deps.media and records the photos row.
// Files are served at /media/<pathname>: Vercel rewrites to the Blob store, server/dev.ts serves data/media.
import { randomUUID } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import type { Deps } from '../deps.js';
import { currentUser, requireUser } from '../lib/auth.js';
import { checkCap } from '../lib/caps.js';
import { fail } from '../lib/http.js';
import { JPEG_MAX_SIDE, JpegError, JpegTooLargeError, isJpeg, stripJpegMetadata } from '../lib/jpeg.js';
import { deleteMedia } from '../lib/media.js';
import { PHOTO_MAX_BYTES, type PhotoResponse } from '../../shared/types/listings.js';

export function mediaUrl(pathname: string): string {
  return `/media/${pathname}`;
}

export function router(deps: Deps): Router {
  const r = Router();

  // Refuse anything that is not declared as a JPEG before reading the body.
  const jpegOnly: RequestHandler = (req, _res, next) => {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'image/jpeg') fail(415, 'Please choose a JPEG photo.', 'unsupported_media');
    next();
  };

  // The cap is checked before the body is read, so a member over the cap uploads nothing.
  // It is checked again under the member's cap lock in the insert transaction (lib/caps.ts).
  const photoCap: RequestHandler = async (_req, res, next) => {
    await deps.db.tx((q) => checkCap(q, currentUser(res), 'photo'));
    next();
  };

  r.post(
    '/photos',
    requireUser,
    jpegOnly,
    photoCap,
    express.raw({ type: 'image/jpeg', limit: PHOTO_MAX_BYTES }),
    async (req, res) => {
      const user = currentUser(res);
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) fail(400, 'The photo was empty.', 'empty_photo');
      if (!isJpeg(body)) fail(415, 'Please choose a JPEG photo.', 'unsupported_media');
      let stripped;
      try {
        stripped = stripJpegMetadata(body);
      } catch (err) {
        if (err instanceof JpegTooLargeError) {
          fail(415, `That photo is too big. Please use one up to ${JPEG_MAX_SIDE} pixels on each side.`, 'photo_too_large');
        }
        if (err instanceof JpegError) fail(415, 'That photo could not be read. Please try another.', 'bad_jpeg');
        throw err;
      }
      const { pathname } = await deps.media.put(`photos/${randomUUID()}.jpg`, stripped.data, 'image/jpeg');
      let row: { id: string };
      try {
        row = await deps.db.tx(async (q) => {
          await checkCap(q, user, 'photo');
          return q.one<{ id: string }>(
            'INSERT INTO photos (user_id, blob_path, width, height) VALUES ($1, $2, $3, $4) RETURNING id',
            [user.id, pathname, stripped.width, stripped.height],
          );
        });
      } catch (err) {
        // No row points at the bytes, so they would never be served or cleaned up.
        await deleteMedia(deps.media, [pathname]);
        throw err;
      }
      const out: PhotoResponse = { id: row.id, url: mediaUrl(pathname), width: stripped.width, height: stripped.height };
      res.status(201).json(out);
    },
  );

  return r;
}
