-- Listings slice: duplicate check typeahead (GET /api/listings/suggest).
-- pg_trgm would do this, but PGlite needs the extension loaded in its constructor, so this is
-- the same idea in plain SQL: each word is padded like pg_trgm ("  w" + "ord "), split into
-- three character grams, and the distinct grams are stored with a GIN index for the && filter.

CREATE FUNCTION vw_trigrams(t text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT coalesce(array_agg(DISTINCT substr(p.w, i, 3)), '{}')
    FROM unnest(regexp_split_to_array(
           trim(regexp_replace(replace(lower(coalesce(t, '')), '&', ' and '), '[^[:alnum:]]+', ' ', 'g')),
           ' ')) AS words(word)
    CROSS JOIN LATERAL (SELECT '  ' || words.word || ' ' AS w) AS p
    CROSS JOIN LATERAL generate_series(1, length(p.w) - 2) AS i
    WHERE words.word <> ''
  $$;

-- Share of the query's grams found in the name: 1.0 means every gram of q appears.
CREATE FUNCTION vw_trgm_cover(name_grams text[], q_grams text[]) RETURNS double precision
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT CASE WHEN cardinality(q_grams) = 0 THEN 0
      ELSE (SELECT count(*) FROM unnest(q_grams) g WHERE g = ANY (name_grams))::double precision / cardinality(q_grams) END
  $$;

ALTER TABLE listings ADD COLUMN name_trgm text[] GENERATED ALWAYS AS (vw_trigrams(name)) STORED;
CREATE INDEX listings_name_trgm_idx ON listings USING gin (name_trgm);
