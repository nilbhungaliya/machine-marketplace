-- F4 + F5 discovery (spec 2026-11-19-f4-f5-discovery-design §4.2, §4.3, §4.6, §5.1): what drizzle-kit 0.22 can't emit.
-- pg_trgm is already enabled by 0000_extensions.sql; normalize() needs Postgres 13+ and a UTF-8 database.

-- §4.2: exactly the target field of the kind is set; a side synonym points at left, right or pair.
ALTER TABLE "search_synonyms" ADD CONSTRAINT "search_synonyms_target_shape" CHECK (
  ("target_kind" IN ('category', 'brand', 'model') AND "target_id" IS NOT NULL AND "target_side" IS NULL AND "target_word" IS NULL)
  OR ("target_kind" = 'side' AND "target_side" IS NOT NULL AND "target_side" <> 'not_applicable' AND "target_id" IS NULL AND "target_word" IS NULL)
  OR ("target_kind" = 'word' AND "target_word" IS NOT NULL AND "target_word" <> '' AND "target_id" IS NULL AND "target_side" IS NULL)
);--> statement-breakpoint
-- One term may point at several targets, never twice at the same one. The spec's "every part cast to text" can't be
-- indexed (an enum-to-text cast isn't IMMUTABLE), so the plain columns with NULLS NOT DISTINCT (Postgres 15+): with the
-- CHECK above exactly one target column is set, which makes this the same key.
CREATE UNIQUE INDEX IF NOT EXISTS "search_synonyms_term_target_uq" ON "search_synonyms" (
  "term_norm", "target_kind", "target_id", "target_side", "target_word"
) NULLS NOT DISTINCT;--> statement-breakpoint
-- §4.3: the stored normalised query is at most 200 characters.
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_normalized_length" CHECK (char_length("normalized") <= 200);--> statement-breakpoint
-- §5.1: the SQL twin of `normalizeSearchText` (services/discovery/normalize.ts); a test compares the two on 40 strings.
-- 1. NFKD, drop Latin combining marks only (U+0300–U+036F), NFC: Devanagari / Gujarati vowel signs, virama and nukta stay.
-- 2. Delete ZWJ, ZWNJ and soft hyphen outright (a space would split an Indic word).
-- 3. Lower-case; Devanagari and Gujarati digits to ASCII.
-- 4. Everything outside a–z, 0–9, U+0900–U+097F and U+0A80–U+0AFF becomes a space, the dandas (U+0964, U+0965) too;
--    collapse spaces and trim.
CREATE OR REPLACE FUNCTION mpm_normalize_search(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(
        lower(
          translate(
            normalize(regexp_replace(normalize(input, NFKD), '[̀-ͯ]', '', 'g'), NFC),
            E'‍‌­',
            ''
          )
        ),
        E'०१२३४५६७८९૦૧૨૩૪૫૬૭૮૯',
        '01234567890123456789'
      ),
      '[^a-z0-9ऀ-ॣ०-ॿ઀-૿]+', ' ', 'g'
    ),
    ' {2,}', ' ', 'g'
  ))
$fn$;
