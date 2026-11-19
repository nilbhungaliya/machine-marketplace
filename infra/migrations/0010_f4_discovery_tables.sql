DO $$ BEGIN
 CREATE TYPE "public"."search_refresh_scope" AS ENUM('category', 'brand', 'model', 'field', 'condition');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."search_script" AS ENUM('latin', 'devanagari', 'gujarati');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."synonym_target" AS ENUM('category', 'brand', 'model', 'side', 'word');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_listings" (
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_listings_pk" PRIMARY KEY("user_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_queries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"normalized" text NOT NULL,
	"words" smallint NOT NULL,
	"result_total" integer NOT NULL,
	"kind" "listing_kind",
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_refresh_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_kind" "search_refresh_scope" NOT NULL,
	"scope_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_synonyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"term_norm" text NOT NULL,
	"script" "search_script" NOT NULL,
	"target_kind" "synonym_target" NOT NULL,
	"target_id" uuid,
	"target_side" "part_side",
	"target_word" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "search_trending_hidden" (
	"normalized" text PRIMARY KEY NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "chip_needs_context" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "search_title_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "search_point" "geography";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "search_refreshed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_refresh_jobs" ADD CONSTRAINT "search_refresh_jobs_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_synonyms" ADD CONSTRAINT "search_synonyms_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_synonyms" ADD CONSTRAINT "search_synonyms_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_trending_hidden" ADD CONSTRAINT "search_trending_hidden_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_listings_user_created_idx" ON "saved_listings" USING btree ("user_id","created_at" DESC NULLS LAST,"listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_queries_day_normalized_idx" ON "search_queries" USING btree ("day","normalized");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_refresh_jobs_pending_idx" ON "search_refresh_jobs" USING btree ("done_at","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_search_text_trgm_idx" ON "listings" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_search_title_text_trgm_idx" ON "listings" USING gin ("search_title_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_search_point_idx" ON "listings" USING gist ("search_point");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_public_refreshed_idx" ON "listings" USING btree ("kind","refreshed_at" DESC NULLS LAST) WHERE "listings"."status" IN ('live', 'reserved', 'rented');