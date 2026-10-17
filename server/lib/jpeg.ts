// Pure JS JPEG metadata stripping for member photos.
// Keeps APP0 (JFIF) and the APP2 ICC colour profile. Drops APP1 (EXIF, XMP: GPS, camera,
// time), APP3 to APP15, other APP2 data (MPF, FlashPix), COM comments, and anything after EOI.
// Pixels are never decoded or re encoded.

export class JpegError extends Error {
  name = 'JpegError';
}

/** The largest width or height accepted. The browser resizes to 1600 px, so only crafted files hit this. */
export const JPEG_MAX_SIDE = 4096;

export class JpegTooLargeError extends JpegError {
  name = 'JpegTooLargeError';
}

export interface StrippedJpeg {
  data: Buffer;
  width: number;
  height: number;
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;

export function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === SOI && buf[2] === 0xff;
}

/** SOF0 to SOF15 carry the frame size. C4 (DHT), C8 (JPG) and CC (DAC) share the range but are not frames. */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Markers with no length field. */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function keepSegment(marker: number, payload: Buffer): boolean {
  if (marker === 0xe0) return true;
  if (marker === 0xe2) return payload.subarray(0, 12).toString('latin1') === 'ICC_PROFILE\0';
  if (marker >= 0xe1 && marker <= 0xef) return false;
  return marker !== COM;
}

/**
 * Return a copy of the JPEG without metadata segments, plus its pixel size.
 * Throws JpegError when the bytes are not a well formed baseline or progressive JPEG.
 */
export function stripJpegMetadata(input: Buffer): StrippedJpeg {
  if (!isJpeg(input)) throw new JpegError('Not a JPEG');
  const out: Buffer[] = [input.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let pos = 2;
  let sawEoi = false;

  while (pos < input.length) {
    if (input[pos] !== 0xff) throw new JpegError('Expected a marker');
    // Any number of 0xFF fill bytes may precede a marker.
    while (pos < input.length && input[pos] === 0xff) pos++;
    if (pos >= input.length) throw new JpegError('Truncated marker');
    const marker = input[pos];
    pos++;

    if (marker === EOI) {
      out.push(Buffer.from([0xff, EOI]));
      sawEoi = true;
      break;
    }
    if (marker === SOI) throw new JpegError('Nested SOI');
    if (isStandalone(marker)) {
      out.push(Buffer.from([0xff, marker]));
      continue;
    }

    if (pos + 2 > input.length) throw new JpegError('Truncated segment length');
    const length = input.readUInt16BE(pos);
    if (length < 2 || pos + length > input.length) throw new JpegError('Bad segment length');
    const segment = input.subarray(pos - 2, pos + length);
    const payload = input.subarray(pos + 2, pos + length);
    pos += length;

    if (isSof(marker)) {
      if (payload.length < 5) throw new JpegError('Short frame header');
      height = payload.readUInt16BE(1);
      width = payload.readUInt16BE(3);
    }
    if (keepSegment(marker, payload)) out.push(segment);

    if (marker === SOS) {
      // Entropy coded data runs until the next real marker. 0xFF00 is a stuffed byte and
      // 0xFFD0 to 0xFFD7 are restart markers; both belong to the scan.
      const start = pos;
      while (pos < input.length) {
        if (input[pos] === 0xff && pos + 1 < input.length) {
          const next = input[pos + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            pos += 2;
            continue;
          }
          // A run of 0xFF is fill before a marker: step to its last byte.
          if (next === 0xff) {
            pos++;
            continue;
          }
          break;
        }
        pos++;
      }
      out.push(input.subarray(start, pos));
    }
  }

  if (!sawEoi) throw new JpegError('Missing EOI');
  if (!width || !height) throw new JpegError('No frame size');
  if (width > JPEG_MAX_SIDE || height > JPEG_MAX_SIDE) throw new JpegTooLargeError('Frame too large');
  return { data: Buffer.concat(out), width, height };
}

/** True when any APP1 (EXIF or XMP) segment is present before the image data. For tests and checks. */
export function hasApp1(buf: Buffer): boolean {
  return listMarkers(buf).includes(0xe1);
}

/** The markers of every header segment up to the first SOS, in order. */
export function listMarkers(buf: Buffer): number[] {
  const markers: number[] = [];
  if (!isJpeg(buf)) return markers;
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break;
    while (pos < buf.length && buf[pos] === 0xff) pos++;
    const marker = buf[pos];
    pos++;
    markers.push(marker);
    if (marker === SOS || marker === EOI) break;
    if (isStandalone(marker)) continue;
    pos += buf.readUInt16BE(pos);
  }
  return markers;
}
