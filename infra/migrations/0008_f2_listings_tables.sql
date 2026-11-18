DO $$ BEGIN
 CREATE TYPE "public"."fitment_source" AS ENUM('seller', 'admin');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gst_price_mode" AS ENUM('included', 'extra');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."history_actor" AS ENUM('seller', 'admin', 'system');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."listing_kind" AS ENUM('part', 'machine', 'machine_rental');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."listing_location_source" AS ENUM('business', 'godown');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."listing_status" AS ENUM('draft', 'pending_review', 'rejected', 'live', 'paused', 'reserved', 'sold', 'rented', 'unavailable', 'expired', 'hidden', 'removed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."media_type" AS ENUM('photo', 'video');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."moderation_outcome" AS ENUM('approved', 'changes_requested', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."part_side" AS ENUM('left', 'right', 'pair', 'not_applicable');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."price_model" AS ENUM('fixed', 'negotiable', 'on_request');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_fuel" AS ENUM('client', 'included', 'per_litre');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_operator" AS ENUM('included', 'optional', 'not_available', 'mandatory');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_period" AS ENUM('hour', 'day', 'week', 'month');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_transport" AS ENUM('owner_delivers', 'renter_picks_up', 'either');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."report_status" AS ENUM('open', 'reviewing', 'actioned', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."report_target" AS ENUM('user', 'business', 'listing', 'conversation');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_admin_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_fitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"model_id" uuid,
	"model_other" text,
	"year_from" smallint,
	"year_to" smallint,
	"note" text,
	"source" "fitment_source" DEFAULT 'seller' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_machines" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid,
	"brand_other" text,
	"model_id" uuid,
	"model_other" text,
	"year" smallint,
	"hours_run" integer,
	"serial_number" text,
	"under_power" boolean DEFAULT false NOT NULL,
	"inspection_by_appointment" boolean DEFAULT false NOT NULL,
	"reason_for_sale" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"type" "media_type" NOT NULL,
	"key" text NOT NULL,
	"thumb_key" text,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_rentals" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"rate_hour_paise" bigint,
	"rate_day_paise" bigint,
	"rate_week_paise" bigint,
	"rate_month_paise" bigint,
	"shift_hours" smallint DEFAULT 8 NOT NULL,
	"month_days" smallint DEFAULT 26 NOT NULL,
	"overtime_rate_hour_paise" bigint,
	"min_duration" smallint,
	"min_duration_period" "rental_period",
	"operator" "rental_operator",
	"operator_rate_day_paise" bigint,
	"fuel" "rental_fuel" DEFAULT 'client' NOT NULL,
	"transport" "rental_transport",
	"transport_charge_paise" bigint,
	"service_radius_km" smallint,
	"deposit_paise" bigint,
	"available_from" date,
	"availability_note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"from_status" "listing_status",
	"to_status" "listing_status" NOT NULL,
	"action" text NOT NULL,
	"actor" "history_actor" NOT NULL,
	"user_id" uuid,
	"admin_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" bigserial NOT NULL,
	"business_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"kind" "listing_kind" NOT NULL,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"category_id" uuid,
	"title" text,
	"title_norm" text,
	"description" text,
	"part_number" text,
	"part_number_norm" text,
	"part_number_base" text,
	"part_brand_id" uuid,
	"side" "part_side",
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quantity" numeric(14, 3),
	"unit_id" uuid,
	"min_order_qty" numeric(14, 3),
	"condition_id" uuid,
	"condition_note" text,
	"price_model" "price_model",
	"price_paise" bigint,
	"gst_mode" "gst_price_mode",
	"location_source" "listing_location_source" DEFAULT 'business' NOT NULL,
	"pincode" text,
	"city" text,
	"state" text,
	"industrial_area_id" uuid,
	"industrial_area_other" text,
	"address_line" text,
	"point" "geography",
	"delivery" text[] DEFAULT '{}'::text[] NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"accepted_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"review_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"return_status" "listing_status",
	"moderation_outcome" "moderation_outcome",
	"moderation_note" text,
	"moderated_at" timestamp with time zone,
	"moderated_by" uuid,
	"status_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"first_live_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_user_id" uuid,
	"reporter_business_id" uuid,
	"reason" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "is_machine_unit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_fitments" ADD CONSTRAINT "listing_fitments_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_fitments" ADD CONSTRAINT "listing_fitments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_fitments" ADD CONSTRAINT "listing_fitments_model_id_machine_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."machine_models"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_machines" ADD CONSTRAINT "listing_machines_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_machines" ADD CONSTRAINT "listing_machines_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_machines" ADD CONSTRAINT "listing_machines_model_id_machine_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."machine_models"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_rentals" ADD CONSTRAINT "listing_rentals_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_status_history" ADD CONSTRAINT "listing_status_history_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_status_history" ADD CONSTRAINT "listing_status_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_status_history" ADD CONSTRAINT "listing_status_history_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_part_brand_id_brands_id_fk" FOREIGN KEY ("part_brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_condition_id_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."conditions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_industrial_area_id_industrial_areas_id_fk" FOREIGN KEY ("industrial_area_id") REFERENCES "public"."industrial_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_moderated_by_admin_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_business_id_businesses_id_fk" FOREIGN KEY ("reporter_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_admin_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_fitments_listing_id_idx" ON "listing_fitments" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_fitments_model_id_idx" ON "listing_fitments" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_fitments_brand_id_idx" ON "listing_fitments" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_machines_brand_id_idx" ON "listing_machines" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_machines_model_id_idx" ON "listing_machines" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_media_listing_sort_idx" ON "listing_media" USING btree ("listing_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_status_history_listing_created_idx" ON "listing_status_history" USING btree ("listing_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_point_idx" ON "listings" USING gist ("point");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_status_kind_category_idx" ON "listings" USING btree ("status","kind","category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_business_status_updated_idx" ON "listings" USING btree ("business_id","status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_category_id_idx" ON "listings" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_part_number_norm_idx" ON "listings" USING btree ("part_number_norm") WHERE "listings"."part_number_norm" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_part_number_base_idx" ON "listings" USING btree ("part_number_base") WHERE "listings"."part_number_base" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_status_refreshed_idx" ON "listings" USING btree ("status","refreshed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_target_status_idx" ON "reports" USING btree ("target_type","target_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reports_one_open_uq" ON "reports" USING btree ("reporter_business_id","target_type","target_id") WHERE "reports"."status" IN ('open', 'reviewing');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_business_id_idx" ON "users" USING btree ("business_id");