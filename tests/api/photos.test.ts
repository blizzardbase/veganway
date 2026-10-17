import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, signUp, type SignedUp, type TestApp } from '../helpers.js';
import { hasApp1, listMarkers, stripJpegMetadata } from '../../server/lib/jpeg.js';
import type { PhotoResponse } from '../../shared/types/listings.js';

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/**
 * A structurally valid JPEG: SOI, JFIF, optional EXIF (with a fake GPS tag and camera serial),
 * ICC profile, a comment, DQT, SOF0 for width by height, DHT, SOS with stuffed and restart bytes, EOI,
 * then trailing bytes after EOI. The server never decodes pixels, so the scan data can be arbitrary.
 */
function makeJpeg({ exif = true, width = 640, height = 480, scanBytes = 64 } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  parts.push(segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')));
  if (exif) parts.push(segment(0xe1, Buffer.from('Exif\0\0MM\0*GPSLatitude 25.2048 SerialNumber CAM-12345', 'latin1')));
  parts.push(segment(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01fake-icc', 'latin1')));
  parts.push(segment(0xe2, Buffer.from('MPF\0secondary-image-offsets', 'latin1')));
  parts.push(segment(0xed, Buffer.from('Photoshop 3.0\0IPTC location', 'latin1')));
  parts.push(segment(0xfe, Buffer.from('taken at home', 'latin1')));
  parts.push(segment(0xdb, Buffer.alloc(65, 1)));
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  parts.push(segment(0xc0, sof));
  parts.push(segment(0xc4, Buffer.alloc(20, 2)));
  parts.push(segment(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])));
  const scan = Buffer.alloc(scanBytes, 0x5a);
  scan[10] = 0xff; scan[11] = 0x00; // stuffed byte
  scan[20] = 0xff; scan[21] = 0xd0; // restart marker
  parts.push(scan);
  parts.push(Buffer.from([0xff, 0xd9]));
  parts.push(Buffer.from('trailing data after EOI', 'latin1'));
  return Buffer.concat(parts);
}

describe('jpeg metadata stripping', () => {
  test('drops APP1, APP13, COM, non ICC APP2 and data after EOI; keeps APP0, ICC, tables and scan', () => {
    const input = makeJpeg();
    assert.ok(hasApp1(input));
    const { data, width, height } = stripJpegMetadata(input);
    assert.equal(width, 640);
    assert.equal(height, 480);
    assert.deepEqual(listMarkers(data), [0xe0, 0xe2, 0xdb, 0xc0, 0xc4, 0xda]);
    const text = data.toString('latin1');
    for (const gone of ['Exif', 'GPSLatitude', 'SerialNumber', 'MPF', 'Photoshop', 'taken at home', 'trailing data']) {
      assert.ok(!text.includes(gone), `${gone} should be stripped`);
    }
    assert.ok(text.includes('ICC_PROFILE'));
    assert.deepEqual([...data.subarray(-2)], [0xff, 0xd9]);
    // The scan, with its stuffed byte and restart marker, survives byte for byte.
    const scan = input.subarray(input.indexOf(Buffer.from([0xff, 0xda])), input.lastIndexOf(Buffer.from([0xff, 0xd9])));
    assert.ok(data.includes(scan));
  });

  test('rejects truncated input', () => {
    const input = makeJpeg();
    assert.throws(() => stripJpegMetadata(input.subarray(0, 40)));
  });
});

describe('POST /api/photos', () => {
  let app: TestApp;
  let alice: SignedUp;
  before(async () => {
    app = await makeTestApp();
    alice = await signUp(app.agent());
  });
  after(async () => { await app.close(); });

  test('a JPEG carrying EXIF is stored with no APP1 segment', async () => {
    const res = await alice.agent.post<PhotoResponse>('/api/photos', undefined, { raw: { body: makeJpeg(), contentType: 'image/jpeg' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.url, /^\/media\/photos\/[a-z0-9-]+\.jpg$/);
    assert.equal(res.body.width, 640);
    assert.equal(res.body.height, 480);
    const row = await app.db.one<{ blob_path: string; user_id: string }>('SELECT blob_path, user_id FROM photos WHERE id = $1', [res.body.id]);
    assert.equal(row.user_id, alice.user.id);
    assert.equal(`/media/${row.blob_path}`, res.body.url);
    // The test media store is a temp folder; find the stored bytes through the store's directory.
    const stored = findStored(row.blob_path);
    assert.ok(stored, 'stored file exists');
    const bytes = readFileSync(stored);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.equal(hasApp1(bytes), false);
    assert.ok(!bytes.toString('latin1').includes('GPSLatitude'));
  });

  test('a PNG is rejected with 415, whatever it claims to be', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const asPng = await alice.agent.post('/api/photos', undefined, { raw: { body: png, contentType: 'image/png' } });
    assert.equal(asPng.status, 415);
    const disguised = await alice.agent.post('/api/photos', undefined, { raw: { body: png, contentType: 'image/jpeg' } });
    assert.equal(disguised.status, 415);
  });

  test('a 3 MB body is rejected with 413', async () => {
    const big = makeJpeg({ scanBytes: 3 * 1024 * 1024 });
    const res = await alice.agent.post('/api/photos', undefined, { raw: { body: big, contentType: 'image/jpeg' } });
    assert.equal(res.status, 413);
  });

  test('signed out upload is 401', async () => {
    const res = await app.agent().post('/api/photos', undefined, { raw: { body: makeJpeg(), contentType: 'image/jpeg' } });
    assert.equal(res.status, 401);
  });

  test('daily photo cap applies (10 for a new account)', async () => {
    const bob = await signUp(app.agent());
    for (let i = 0; i < 10; i++) {
      const ok = await bob.agent.post('/api/photos', undefined, { raw: { body: makeJpeg({ exif: false }), contentType: 'image/jpeg' } });
      assert.equal(ok.status, 201);
    }
    const over = await bob.agent.post('/api/photos', undefined, { raw: { body: makeJpeg({ exif: false }), contentType: 'image/jpeg' } });
    assert.equal(over.status, 429);
  });
});

/** The test app stores media in a fresh vw-media-* temp folder; look for the pathname in each. */
function findStored(pathname: string): string | null {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('vw-media-')) continue;
    const full = join(tmpdir(), name, pathname);
    if (existsSync(full)) return full;
  }
  return null;
}
