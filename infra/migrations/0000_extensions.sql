-- Before the generated tables: `businesses.location` (and later listing locations) need PostGIS, and part / machine
-- name search will use trigram indexes from pg_trgm.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
