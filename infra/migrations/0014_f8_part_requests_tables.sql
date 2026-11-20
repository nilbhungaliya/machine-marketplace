DO $$ BEGIN
 CREATE TYPE "public"."part_request_audience" AS ENUM('verified_only', 'any_seller');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_close_reason" AS ENUM('found_elsewhere', 'no_longer_needed', 'posted_by_mistake', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_drop_reason" AS ENUM('listing_removed', 'listing_removed_by_team', 'listing_rejected', 'request_closed', 'request_expired', 'request_removed', 'blocked', 'not_eligible', 'no_longer_fits');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_feedback_reason" AS ENUM('dont_sell_this', 'too_far', 'wrong_category', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_kind" AS ENUM('part', 'machine');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_match_source" AS ENUM('listing_live', 'at_post');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_match_tier" AS ENUM('part_number', 'name_fit', 'name', 'machine_fit');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_reach" AS ENUM('radius_50', 'radius_200', 'state', 'all_india');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_reply_status" AS ENUM('pending', 'delivered', 'withdrawn', 'dropped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_status" AS ENUM('active', 'fulfilled', 'closed', 'expired', 'removed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_request_work_kind" AS ENUM('target_request', 'listing_changed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "notification_category" ADD VALUE 'requests';--> statement-breakpoint
ALTER TYPE "report_target" ADD VALUE 'part_request';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_request_feedback" (
	"part_request_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"reason" "part_request_feedback_reason",
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_request_feedback_pk" PRIMARY KEY("part_request_id","business_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_request_fitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_request_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"model_id" uuid,
	"year_from" smallint,
	"year_to" smallint,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_request_matches" (
	"part_request_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"seller_business_id" uuid NOT NULL,
	"tier" "part_request_match_tier" NOT NULL,
	"distance_km" integer,
	"source" "part_request_match_source" NOT NULL,
	"pushed" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_request_matches_pk" PRIMARY KEY("part_request_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_request_push_counts" (
	"business_id" uuid NOT NULL,
	"day" date NOT NULL,
	"pushes" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "part_request_push_counts_pk" PRIMARY KEY("business_id","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_request_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_request_id" uuid NOT NULL,
	"seller_business_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"message" text,
	"message_flagged" boolean DEFAULT false NOT NULL,
	"status" "part_request_reply_status" NOT NULL,
	"drop_reason" "part_request_drop_reason",
	"delivered_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	"buyer_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_request_targets" (
	"part_request_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	"rank" smallint NOT NULL,
	"pass" smallint NOT NULL,
	"best_listing_id" uuid,
	"pushed" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	CONSTRAINT "part_request_targets_pk" PRIMARY KEY("part_request_id","business_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_request_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "part_request_work_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "part_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" bigserial NOT NULL,
	"business_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"kind" "part_request_kind" NOT NULL,
	"status" "part_request_status" DEFAULT 'active' NOT NULL,
	"return_status" "part_request_status",
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"part_number" text,
	"part_number_norm" text,
	"part_number_base" text,
	"side" "part_side",
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_id" uuid NOT NULL,
	"condition_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"budget_per_unit_paise" bigint,
	"budget_visible" boolean DEFAULT false NOT NULL,
	"needed_by" date,
	"urgent" boolean DEFAULT false NOT NULL,
	"reach" "part_request_reach" DEFAULT 'radius_200' NOT NULL,
	"audience" "part_request_audience" DEFAULT 'verified_only' NOT NULL,
	"point" "geography",
	"pincode" text,
	"city" text,
	"state" text,
	"industrial_area_id" uuid,
	"industrial_area_other" text,
	"photo_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"note_flagged" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"validity_days" smallint NOT NULL,
	"first_posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"expiring_notified_at" timestamp with time zone,
	"close_reason" "part_request_close_reason",
	"closed_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_deal_id" uuid,
	"removed_at" timestamp with time zone,
	"removed_by_admin_id" uuid,
	"removed_reason" text,
	"target_pass" smallint DEFAULT 0 NOT NULL,
	"targeted_at" timestamp with time zone,
	"match_push_day" date,
	"match_push_day_count" smallint DEFAULT 0 NOT NULL,
	"match_push_total" smallint DEFAULT 0 NOT NULL,
	"buyer_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_requests_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "part_request_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_feedback" ADD CONSTRAINT "part_request_feedback_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_feedback" ADD CONSTRAINT "part_request_feedback_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_feedback" ADD CONSTRAINT "part_request_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_fitments" ADD CONSTRAINT "part_request_fitments_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_fitments" ADD CONSTRAINT "part_request_fitments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_fitments" ADD CONSTRAINT "part_request_fitments_model_id_machine_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."machine_models"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_matches" ADD CONSTRAINT "part_request_matches_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_matches" ADD CONSTRAINT "part_request_matches_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_matches" ADD CONSTRAINT "part_request_matches_seller_business_id_businesses_id_fk" FOREIGN KEY ("seller_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_push_counts" ADD CONSTRAINT "part_request_push_counts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_replies" ADD CONSTRAINT "part_request_replies_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_replies" ADD CONSTRAINT "part_request_replies_seller_business_id_businesses_id_fk" FOREIGN KEY ("seller_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_replies" ADD CONSTRAINT "part_request_replies_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_replies" ADD CONSTRAINT "part_request_replies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_targets" ADD CONSTRAINT "part_request_targets_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_targets" ADD CONSTRAINT "part_request_targets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_request_targets" ADD CONSTRAINT "part_request_targets_best_listing_id_listings_id_fk" FOREIGN KEY ("best_listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_industrial_area_id_industrial_areas_id_fk" FOREIGN KEY ("industrial_area_id") REFERENCES "public"."industrial_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_fulfilled_deal_id_deals_id_fk" FOREIGN KEY ("fulfilled_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_removed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("removed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_fitments_request_idx" ON "part_request_fitments" USING btree ("part_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_matches_listing_idx" ON "part_request_matches" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "part_request_replies_request_listing_uq" ON "part_request_replies" USING btree ("part_request_id","listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_replies_request_status_idx" ON "part_request_replies" USING btree ("part_request_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_replies_pending_listing_idx" ON "part_request_replies" USING btree ("listing_id") WHERE "part_request_replies"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_replies_seller_created_idx" ON "part_request_replies" USING btree ("seller_business_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_targets_business_notified_idx" ON "part_request_targets" USING btree ("business_id","notified_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "part_request_work_unclaimed_uq" ON "part_request_work" USING btree ("kind","subject_id") WHERE "part_request_work"."claimed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_work_due_idx" ON "part_request_work" USING btree ("next_attempt_at") WHERE "part_request_work"."claimed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_request_work_claimed_idx" ON "part_request_work" USING btree ("claimed_at") WHERE "part_request_work"."done_at" IS NULL AND "part_request_work"."failed_at" IS NULL AND "part_request_work"."claimed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_requests_business_status_created_idx" ON "part_requests" USING btree ("business_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_requests_active_kind_category_idx" ON "part_requests" USING btree ("kind","category_id") WHERE "part_requests"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_requests_active_expires_idx" ON "part_requests" USING btree ("expires_at") WHERE "part_requests"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_requests_active_point_idx" ON "part_requests" USING gist ("point") WHERE "part_requests"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_requests_status_created_idx" ON "part_requests" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_part_request_id_part_requests_id_fk" FOREIGN KEY ("part_request_id") REFERENCES "public"."part_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_open_request_row" ON "notifications" USING btree ("user_id","part_request_id","type") WHERE "notifications"."type" IN ('part_match', 'part_request_reply') AND "notifications"."read_at" IS NULL;