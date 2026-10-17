-- VeganWay DXB v2 initial schema. Spec section 4.
-- Slice migrations use reserved number ranges only:
--   listings 010 to 019, talk 020 to 029, services/me/admin/search 030 to 039.

-- Generated columns need immutable expressions. array_to_string is only STABLE,
-- so this wrapper is declared IMMUTABLE for text[] input, where that holds.
CREATE FUNCTION vw_join_text(arr text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT coalesce(array_to_string(arr, ' '), '') $$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- HMAC-SHA256 of the trimmed lowercased email. The email itself is never stored.
  email_hmac text UNIQUE,
  pw_hash text,
  recovery_hash text,
  pseudonym text NOT NULL,
  pseudonym_confirmed_at timestamptz,
  display_name text,
  bio text,
  avatar_photo_id uuid,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  has_service boolean NOT NULL DEFAULT false,
  -- System accounts (the "VeganWay" author of welcome topics) can never log in.
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  banned_at timestamptz,
  -- Set when a member deletes their account; their posts then show as "Former member".
  deleted_at timestamptz,
  CONSTRAINT users_login_shape CHECK (is_system OR (email_hmac IS NOT NULL AND pw_hash IS NOT NULL AND recovery_hash IS NOT NULL) OR deleted_at IS NOT NULL)
);
CREATE UNIQUE INDEX users_pseudonym_key ON users (lower(pseudonym));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expires_idx ON rate_limits (expires_at);

CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  blob_path text NOT NULL UNIQUE,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX photos_user_created_idx ON photos (user_id, created_at);

ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_photo_id) REFERENCES photos (id) ON DELETE SET NULL;

CREATE TABLE listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('place', 'product', 'service')),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT '',
  area text,
  stores text[] NOT NULL DEFAULT '{}',
  vegan_status text NOT NULL CHECK (vegan_status IN ('fully_vegan', 'vegan_options', 'vegan_product')),
  summary text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  maps_url text CHECK (maps_url IS NULL OR maps_url ~ '^https://'),
  owner_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  contact jsonb CHECK (contact IS NULL OR kind = 'service'),
  photo_id uuid REFERENCES photos (id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, vw_join_text(tags) || ' ' || coalesce(category, '')), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(summary, '') || ' ' || coalesce(area, '') || ' ' || vw_join_text(stores)), 'C')
  ) STORED
);
CREATE INDEX listings_search_idx ON listings USING gin (search);
CREATE INDEX listings_name_prefix_idx ON listings (lower(name) text_pattern_ops);
CREATE INDEX listings_kind_created_idx ON listings (kind, created_at DESC) WHERE NOT hidden;
CREATE INDEX listings_created_by_idx ON listings (created_by, created_at);

CREATE TABLE recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  offer text,
  offer_expires_at timestamptz,
  photo_id uuid REFERENCES photos (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false,
  -- Reserved for a later WhatsApp import (docs/ingestion.md). Always NULL for member posts.
  source_key text UNIQUE,
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(body, '') || ' ' || coalesce(offer, ''))
  ) STORED
);
CREATE INDEX recommendations_search_idx ON recommendations USING gin (search);
CREATE INDEX recommendations_listing_idx ON recommendations (listing_id, created_at DESC);
CREATE INDEX recommendations_user_idx ON recommendations (user_id, created_at);
CREATE INDEX recommendations_offer_idx ON recommendations (offer_expires_at) WHERE offer IS NOT NULL AND NOT hidden;

CREATE TABLE opinions (
  listing_id uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  value text NOT NULL CHECK (value IN ('recommend', 'not_for_me')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, user_id)
);

CREATE TABLE upvotes (
  target_type text NOT NULL CHECK (target_type IN ('recommendation', 'topic', 'reply')),
  target_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_type, target_id, user_id)
);
CREATE INDEX upvotes_target_idx ON upvotes (target_type, target_id);

CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('discussion', 'poll')),
  title text NOT NULL,
  body text,
  tags text[] NOT NULL DEFAULT '{}',
  listing_ids uuid[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  closes_at timestamptz CHECK (closes_at IS NULL OR kind = 'poll'),
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false,
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, vw_join_text(tags)), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(body, '')), 'C')
  ) STORED
);
CREATE INDEX topics_search_idx ON topics USING gin (search);
CREATE INDEX topics_created_idx ON topics (created_at DESC) WHERE NOT hidden;
CREATE INDEX topics_pinned_idx ON topics (pinned) WHERE pinned AND NOT hidden;

CREATE TABLE poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL,
  UNIQUE (topic_id, position)
);

CREATE TABLE poll_votes (
  topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, user_id)
);
CREATE INDEX poll_votes_option_idx ON poll_votes (option_id);

CREATE TABLE replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('listing', 'topic')),
  target_id uuid NOT NULL,
  parent_id uuid REFERENCES replies (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(body, ''))) STORED
);
CREATE INDEX replies_search_idx ON replies USING gin (search);
CREATE INDEX replies_target_idx ON replies (target_type, target_id, created_at);
CREATE INDEX replies_user_idx ON replies (user_id, created_at);

CREATE TABLE bookmarks (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^VW-[0-9]{4}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz
);
CREATE INDEX claims_status_idx ON claims (status, created_at);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('listing', 'recommendation', 'topic', 'reply', 'photo', 'user')),
  target_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('spam', 'wrong_info', 'offensive', 'personal_info', 'other')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  -- One open report per member per target, so three reports means three members.
  UNIQUE (target_type, target_id, user_id)
);
CREATE INDEX reports_open_idx ON reports (target_type, target_id) WHERE resolved_at IS NULL;

CREATE TABLE audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL actor means the command line (npm run admin) or the system.
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON audit (created_at DESC);

-- The no login system author of pinned welcome topics.
INSERT INTO users (id, pseudonym, pseudonym_confirmed_at, role, is_system)
VALUES ('00000000-0000-4000-8000-000000000001', 'VeganWay', now(), 'admin', true);
