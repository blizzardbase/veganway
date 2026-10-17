// Client side photo preparation: the browser applies the EXIF rotation, scales to at most
// 1600 px on the long side and re encodes as JPEG at 0.82. Re encoding drops most metadata;
// the server strips what is left (server/lib/jpeg.ts).
import { api } from '../../api/client';
import { PHOTO_MAX_BYTES, type PhotoResponse } from '../../../shared/types/listings';

export const PHOTO_MAX_EDGE = 1600;

export async function resizeToJpeg(file: Blob, maxEdge = PHOTO_MAX_EDGE): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That file is not a photo this browser can read. Try a JPEG or PNG.');
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare photos.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', 0.82);
  });
}

/** Resize, then upload. Returns the stored photo's id and same origin URL. */
export async function uploadPhoto(file: Blob): Promise<PhotoResponse> {
  const jpeg = await resizeToJpeg(file);
  if (jpeg.size > PHOTO_MAX_BYTES) throw new Error('That photo is too large even after resizing. Try another.');
  return api.upload<PhotoResponse>('/api/photos', jpeg);
}
