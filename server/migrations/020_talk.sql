-- Talk slice. Soft delete for replies ("Deleted" stays in the thread) and lookup indexes.
ALTER TABLE replies ADD COLUMN deleted_at timestamptz;

-- GET /api/talk/linked?listing_id= and the tag filter on the topic list.
CREATE INDEX topics_listing_ids_idx ON topics USING gin (listing_ids);
CREATE INDEX topics_tags_idx ON topics USING gin (tags);
-- The daily topic cap counts a member's topics in the last 24 hours.
CREATE INDEX topics_user_created_idx ON topics (user_id, created_at);
