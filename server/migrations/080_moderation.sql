-- A merge keeps the old slug permanently, while only its survivor can be restored.
ALTER TABLE listings ADD COLUMN merged_into_id uuid REFERENCES listings(id);
ALTER TABLE listings ADD CONSTRAINT listings_merge_not_self CHECK (merged_into_id IS NULL OR merged_into_id <> id);
CREATE INDEX listings_merged_into_idx ON listings (merged_into_id) WHERE merged_into_id IS NOT NULL;

-- Recover prior merges only where the latest audit relationships form an acyclic chain.
-- Cyclic historical actions cannot identify a survivor reliably and need manual reconciliation.
WITH RECURSIVE edges AS (
  SELECT DISTINCT ON (loser.id) loser.id AS loser_id, survivor.id AS survivor_id
  FROM audit a JOIN listings loser ON loser.id::text = a.detail->>'loserId'
  JOIN listings survivor ON survivor.id::text = a.target_id
  WHERE a.action = 'listing.merge' AND loser.id <> survivor.id AND loser.hidden
  ORDER BY loser.id, a.created_at DESC, a.id DESC
), walk AS (
  SELECT loser_id AS start_id, survivor_id AS next_id, ARRAY[loser_id] AS visited, false AS cycle FROM edges
  UNION ALL
  SELECT w.start_id, e.survivor_id, w.visited || e.loser_id, e.loser_id = ANY(w.visited)
  FROM walk w JOIN edges e ON e.loser_id = w.next_id WHERE NOT w.cycle
)
UPDATE listings l SET merged_into_id = e.survivor_id
FROM edges e WHERE l.id = e.loser_id AND NOT EXISTS (
  SELECT 1 FROM walk w WHERE w.start_id = e.loser_id AND w.cycle
);

-- The old merge cleared the duplicate's owner, but could leave their claim approved.
UPDATE claims c SET status = 'revoked', decided_at = now()
FROM listings l WHERE c.listing_id = l.id AND l.merged_into_id IS NOT NULL AND c.status = 'approved';
UPDATE users u SET has_service = EXISTS (SELECT 1 FROM listings l WHERE l.owner_user_id = u.id AND l.kind = 'service')
WHERE u.id IN (SELECT c.user_id FROM claims c JOIN listings l ON l.id = c.listing_id WHERE l.merged_into_id IS NOT NULL);

-- Auto hides retain the bytes until an admin decides.
ALTER TABLE photos ADD COLUMN hidden boolean NOT NULL DEFAULT false;

-- Work is recorded in the same transaction that removes a photo from app responses.
CREATE TABLE media_deletions (
  blob_path text PRIMARY KEY,
  photo_id uuid NOT NULL REFERENCES photos(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  completed_at timestamptz
);
CREATE INDEX media_deletions_pending_idx ON media_deletions (attempted_at NULLS FIRST, created_at) WHERE completed_at IS NULL;
-- Legacy deletion already removed these bytes; do not retry the entire history.
INSERT INTO media_deletions (blob_path, photo_id, completed_at) SELECT blob_path, id, deleted_at FROM photos WHERE deleted_at IS NOT NULL;
CREATE FUNCTION queue_photo_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    INSERT INTO media_deletions (blob_path, photo_id) VALUES (NEW.blob_path, NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER photos_queue_deletion AFTER INSERT OR UPDATE OF deleted_at ON photos
  FOR EACH ROW EXECUTE FUNCTION queue_photo_deletion();

-- Shared projection lets the queues hydrate every target type in a single statement.
CREATE VIEW moderation_targets AS
SELECT 'listing'::text AS target_type, l.id, l.created_at, l.name AS title, l.summary AS body,
  '/' || CASE l.kind WHEN 'service' THEN 'services' WHEN 'product' THEN 'products' ELSE 'places' END || '/' || l.slug AS path,
  l.hidden, u.pseudonym AS author, u.id AS author_id, l.merged_into_id IS NOT NULL AS merged
FROM listings l JOIN users u ON u.id = l.created_by
UNION ALL
SELECT 'recommendation', r.id, r.created_at, 'Recommendation on ' || l.name, r.body,
  '/' || CASE l.kind WHEN 'service' THEN 'services' WHEN 'product' THEN 'products' ELSE 'places' END || '/' || l.slug,
  r.hidden, u.pseudonym, u.id, false
FROM recommendations r JOIN listings l ON l.id = r.listing_id JOIN users u ON u.id = r.user_id
UNION ALL
SELECT 'topic', t.id, t.created_at, t.title, t.body, '/talk/' || t.id, t.hidden, u.pseudonym, u.id, false
FROM topics t JOIN users u ON u.id = t.user_id
UNION ALL
SELECT 'reply', r.id, r.created_at, 'Reply' || coalesce(' on ' || coalesce(t.title,l.name),''), r.body,
  CASE WHEN r.target_type = 'topic' THEN '/talk/' || r.target_id
       WHEN l.id IS NOT NULL THEN '/' || CASE l.kind WHEN 'service' THEN 'services' WHEN 'product' THEN 'products' ELSE 'places' END || '/' || l.slug END,
  r.hidden, u.pseudonym, u.id, false
FROM replies r JOIN users u ON u.id = r.user_id
LEFT JOIN topics t ON r.target_type = 'topic' AND t.id = r.target_id
LEFT JOIN listings l ON r.target_type = 'listing' AND l.id = r.target_id
UNION ALL
SELECT 'photo', p.id, p.created_at, 'Photo by ' || u.pseudonym, NULL,
  CASE WHEN p.deleted_at IS NULL AND NOT p.hidden THEN '/media/' || p.blob_path END, p.hidden OR p.deleted_at IS NOT NULL, u.pseudonym, u.id, false
FROM photos p JOIN users u ON u.id = p.user_id
UNION ALL
SELECT 'user', u.id, u.created_at, u.pseudonym || CASE WHEN u.banned_at IS NOT NULL THEN ' (banned)' ELSE '' END,
  nullif(concat_ws(': ',u.display_name,u.bio),''), NULL, u.profile_hidden, u.pseudonym, u.id, false
FROM users u WHERE NOT u.is_system AND u.deleted_at IS NULL;
CREATE INDEX audit_moderation_latest_idx ON audit (target_type, target_id, created_at DESC, id DESC)
  WHERE action IN ('report.auto_hide','moderation.hide','moderation.restore');
