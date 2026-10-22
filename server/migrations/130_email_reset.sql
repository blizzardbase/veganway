-- 2026-10-17, the group admin's decision: emailed reset links replace recovery codes.
-- Keep legacy hashes untouched and nullable. Existing accounts and passwords stay valid.
ALTER TABLE users DROP CONSTRAINT users_login_shape;
ALTER TABLE users ADD CONSTRAINT users_login_shape CHECK (
  is_system OR (email_hmac IS NOT NULL AND pw_hash IS NOT NULL) OR deleted_at IS NOT NULL
);

CREATE TABLE password_reset_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  used_at timestamptz
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE UNIQUE INDEX password_reset_tokens_unused_idx ON password_reset_tokens (user_id) WHERE used_at IS NULL;
