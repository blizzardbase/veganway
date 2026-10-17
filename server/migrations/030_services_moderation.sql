-- Services, Me, Admin and Search slice (030 to 039).

-- Deleted accounts all become "Former member", so a pseudonym only has to be unique among live accounts.
DROP INDEX users_pseudonym_key;
CREATE UNIQUE INDEX users_pseudonym_key ON users (lower(pseudonym)) WHERE deleted_at IS NULL;

-- Theme choice from Me. The browser keeps its own copy; this lets the choice follow a member to a new device.
ALTER TABLE users ADD COLUMN theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark'));

-- Set when three aged reports (or an admin) hide a member's optional public profile fields.
-- Public reads should then show the pseudonym only.
ALTER TABLE users ADD COLUMN profile_hidden boolean NOT NULL DEFAULT false;

-- One pending claim per member per listing, and two pending codes never collide.
CREATE UNIQUE INDEX claims_pending_member_key ON claims (listing_id, user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX claims_pending_code_key ON claims (code) WHERE status = 'pending';
CREATE INDEX claims_listing_idx ON claims (listing_id);

CREATE INDEX listings_owner_idx ON listings (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX audit_target_idx ON audit (target_type, target_id);

-- Talk's 020 adds this column (soft deleted replies). Search and My posts skip deleted replies, so make
-- sure it exists even when this slice is tested without 020. A no op once 020 has run.
ALTER TABLE replies ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
