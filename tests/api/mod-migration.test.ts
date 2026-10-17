import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDb } from '../../server/db.js';
import { listMigrations } from '../../server/migrate.js';

test('080 recovers acyclic historical merges and completes legacy byte deletions', async () => {
  const db = createDb({ url: 'pglite://memory' });
  try {
    for (const file of (await listMigrations()).filter(file => file < '080')) {
      await db.exec(await readFile(new URL(`../../server/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const owner = '00000000-0000-4000-8000-000000000001';
    const listings = await db.query<{ id: string; slug: string }>(`INSERT INTO listings (kind,name,slug,vegan_status,created_by) SELECT 'place','Historical '||n,'historical-'||n,'fully_vegan',$1 FROM generate_series(1,5) n RETURNING id,slug`, [owner]);
    await db.query('UPDATE listings SET hidden=true WHERE id=ANY($1::uuid[])', [[listings[0].id, listings[1].id, listings[3].id, listings[4].id]]);
    for (const [loser, survivor] of [[0, 1], [1, 2], [3, 4], [4, 3]]) {
      await db.query(`INSERT INTO audit (action,target_type,target_id,detail) VALUES ('listing.merge','listing',$1,jsonb_build_object('loserId',$2::text))`, [listings[survivor].id, listings[loser].id]);
    }
    const photo = await db.one<{ id: string }>(`INSERT INTO photos (user_id,blob_path,width,height,deleted_at) VALUES ($1,'historical.jpg',1,1,now()) RETURNING id`, [owner]);
    await db.exec(await readFile(new URL('../../server/migrations/080_moderation.sql', import.meta.url), 'utf8'));
    const merged = await db.query<{ id: string; merged_into_id: string | null; hidden: boolean }>('SELECT id,merged_into_id,hidden FROM listings');
    assert.equal(merged.find(l => l.id === listings[0].id)?.merged_into_id, listings[1].id);
    assert.equal(merged.find(l => l.id === listings[1].id)?.merged_into_id, listings[2].id);
    assert.equal(merged.find(l => l.id === listings[0].id)?.hidden, true);
    assert.equal(merged.find(l => l.id === listings[3].id)?.merged_into_id, null, 'cyclic legacy history needs manual reconciliation');
    const pending = await db.one<{ photo_id: string; completed_at: Date | null }>('SELECT photo_id,completed_at FROM media_deletions');
    assert.equal(pending.photo_id, photo.id);
    assert.ok(pending.completed_at, 'legacy code already deleted these bytes');
  } finally { await db.close(); }
});

test('review 8: 080 preserves visible restored merge losers and their later recommendations', async () => {
  const db = createDb({ url: 'pglite://memory' });
  try {
    for (const file of (await listMigrations()).filter(file => file < '080')) {
      await db.exec(await readFile(new URL(`../../server/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const owner = '00000000-0000-4000-8000-000000000001';
    const listings = await db.query<{ id: string }>(`INSERT INTO listings (kind,name,slug,vegan_status,created_by)
      SELECT 'place','Restored '||n,'restored-'||n,'fully_vegan',$1 FROM generate_series(1,2) n RETURNING id`, [owner]);
    // The old merge hid its loser, then an admin intentionally restored it.
    await db.query('UPDATE listings SET hidden=true WHERE id=$1', [listings[0].id]);
    await db.query(`INSERT INTO audit (action,target_type,target_id,detail) VALUES ('listing.merge','listing',$1,jsonb_build_object('loserId',$2::text))`, [listings[1].id, listings[0].id]);
    await db.query('UPDATE listings SET hidden=false WHERE id=$1', [listings[0].id]);
    await db.query(`INSERT INTO audit (action,target_type,target_id) VALUES ('moderation.restore','listing',$1)`, [listings[0].id]);
    const rec = await db.one<{ id: string }>(`INSERT INTO recommendations (listing_id,user_id,body) VALUES ($1,$2,'A later recommendation') RETURNING id`, [listings[0].id, owner]);
    await db.exec(await readFile(new URL('../../server/migrations/080_moderation.sql', import.meta.url), 'utf8'));
    const loser = await db.one<{ hidden: boolean; merged_into_id: string | null }>('SELECT hidden,merged_into_id FROM listings WHERE id=$1', [listings[0].id]);
    assert.equal(loser.hidden, false);
    assert.equal(loser.merged_into_id, null);
    assert.equal((await db.one<{ listing_id: string }>('SELECT listing_id FROM recommendations WHERE id=$1', [rec.id])).listing_id, listings[0].id);
  } finally { await db.close(); }
});
