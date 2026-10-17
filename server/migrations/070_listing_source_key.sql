-- WhatsApp history import (server/cli/import-history.ts). Each imported listing carries the sha256 of
-- its normalised name, so running the import twice adds nothing. Always NULL for listings members add.
ALTER TABLE listings ADD COLUMN source_key text;
CREATE UNIQUE INDEX listings_source_key_key ON listings (source_key) WHERE source_key IS NOT NULL;
