DO $$ BEGIN
 CREATE TYPE "public"."rental_actor_side" AS ENUM('renter', 'owner', 'system', 'admin');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_block_reason" AS ENUM('maintenance', 'booked_outside', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_booking_status" AS ENUM('requested', 'countered', 'confirmed', 'on_rent', 'returned', 'completed', 'declined', 'withdrawn', 'expired', 'cancelled', 'disputed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_booking_turn" AS ENUM('owner', 'renter');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rental_completed_how" AS ENUM('renter_confirmed', 'auto', 'support');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "message_kind" ADD VALUE 'booking';--> statement-breakpoint
ALTER TYPE "notification_category" ADD VALUE 'rentals';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"machines" smallint NOT NULL,
	"reason" "rental_block_reason" NOT NULL,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"code" text NOT NULL,
	"actor_side" "rental_actor_side" NOT NULL,
	"actor_user_id" uuid,
	"actor_admin_id" uuid,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_booking_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"proposed_by_side" "rental_booking_turn" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"period" "rental_period" NOT NULL,
	"period_count" smallint NOT NULL,
	"machines" smallint NOT NULL,
	"with_operator" boolean NOT NULL,
	"owner_delivers" boolean NOT NULL,
	"estimate_paise" bigint NOT NULL,
	"total_paise" bigint NOT NULL,
	"message" text,
	"message_scam_flag" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rental_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" bigserial NOT NULL,
	"listing_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"renter_business_id" uuid NOT NULL,
	"owner_business_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"status" "rental_booking_status" DEFAULT 'requested' NOT NULL,
	"turn" "rental_booking_turn",
	"current_version_id" uuid,
	"change_count" smallint DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"period" "rental_period" NOT NULL,
	"period_count" smallint NOT NULL,
	"machines" smallint NOT NULL,
	"with_operator" boolean NOT NULL,
	"owner_delivers" boolean NOT NULL,
	"agreed_total_paise" bigint,
	"final_amount_paise" bigint,
	"final_amount_reason" text,
	"final_amount_note" text,
	"site_pincode" text NOT NULL,
	"site_city" text NOT NULL,
	"site_state" text NOT NULL,
	"site_address" text,
	"site_point" "geography",
	"listing_title" text NOT NULL,
	"terms_snapshot" jsonb NOT NULL,
	"reply_due_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"on_site_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"on_site_by_side" "rental_actor_side",
	"hour_meter_start" integer,
	"hour_meter_end" integer,
	"on_site_photo_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"return_photo_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"damage_note" text,
	"auto_complete_at" timestamp with time zone,
	"completed_how" "rental_completed_how",
	"cancelled_by_side" "rental_actor_side",
	"cancel_reason" text,
	"cancel_note" text,
	"decline_reason" text,
	"disputed_from" "rental_booking_status",
	"payment_method" "deal_payment_method",
	"advance_paise" bigint,
	"deposit_paise" bigint,
	"deposit_returned" boolean,
	"expected_on_site_time" text,
	"notes_text" text,
	"notes_scam_flag" boolean DEFAULT false NOT NULL,
	"notes_updated_at" timestamp with time zone,
	"notes_updated_by_user_id" uuid,
	"start_reminded_at" timestamp with time zone,
	"due_reminded_at" timestamp with time zone,
	"overdue_reminded_at" timestamp with time zone,
	"not_started_reminded_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_bookings_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "deal_disputes_one_open";--> statement-breakpoint
ALTER TABLE "deal_disputes" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_reviews" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "rental_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "deal_disputes" ADD COLUMN "rental_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "deal_reviews" ADD COLUMN "rental_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "deal_reviews" ADD COLUMN "r_care" smallint;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "rental_booking_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_blocks" ADD CONSTRAINT "rental_blocks_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_blocks" ADD CONSTRAINT "rental_blocks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_booking_events" ADD CONSTRAINT "rental_booking_events_booking_id_rental_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."rental_bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_booking_events" ADD CONSTRAINT "rental_booking_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_booking_events" ADD CONSTRAINT "rental_booking_events_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_booking_versions" ADD CONSTRAINT "rental_booking_versions_booking_id_rental_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."rental_bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_booking_versions" ADD CONSTRAINT "rental_booking_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_renter_business_id_businesses_id_fk" FOREIGN KEY ("renter_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_owner_business_id_businesses_id_fk" FOREIGN KEY ("owner_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_current_version_id_rental_booking_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."rental_booking_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_notes_updated_by_user_id_users_id_fk" FOREIGN KEY ("notes_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_blocks_listing_range_idx" ON "rental_blocks" USING btree ("listing_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_booking_events_booking_created_idx" ON "rental_booking_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rental_booking_versions_booking_seq_uq" ON "rental_booking_versions" USING btree ("booking_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_capacity_idx" ON "rental_bookings" USING btree ("listing_id","status","start_date","end_date") WHERE "rental_bookings"."status" IN ('confirmed', 'on_rent', 'disputed');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_renter_status_updated_idx" ON "rental_bookings" USING btree ("renter_business_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_owner_status_updated_idx" ON "rental_bookings" USING btree ("owner_business_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_reply_due_idx" ON "rental_bookings" USING btree ("status","reply_due_at") WHERE "rental_bookings"."status" IN ('requested', 'countered');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_auto_complete_idx" ON "rental_bookings" USING btree ("status","auto_complete_at") WHERE "rental_bookings"."status" = 'returned';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_thread_idx" ON "rental_bookings" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_listing_idx" ON "rental_bookings" USING btree ("listing_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_rental_booking_id_rental_bookings_id_fk" FOREIGN KEY ("rental_booking_id") REFERENCES "public"."rental_bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_disputes" ADD CONSTRAINT "deal_disputes_rental_booking_id_rental_bookings_id_fk" FOREIGN KEY ("rental_booking_id") REFERENCES "public"."rental_bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_rental_booking_id_rental_bookings_id_fk" FOREIGN KEY ("rental_booking_id") REFERENCES "public"."rental_bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rental_booking_id_rental_bookings_id_fk" FOREIGN KEY ("rental_booking_id") REFERENCES "public"."rental_bookings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_disputes_one_open_deal" ON "deal_disputes" USING btree ("deal_id") WHERE "deal_disputes"."status" = 'open' AND "deal_disputes"."deal_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_disputes_one_open_rental" ON "deal_disputes" USING btree ("rental_booking_id") WHERE "deal_disputes"."status" = 'open' AND "deal_disputes"."rental_booking_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_reviews_rental_side_uq" ON "deal_reviews" USING btree ("rental_booking_id","reviewer_side") WHERE "deal_reviews"."rental_booking_id" IS NOT NULL;