DO $$ BEGIN
 CREATE TYPE "public"."fraud_signal_kind" AS ENUM('shared_device', 'repeated_phone', 'payment_details', 'new_account_burst', 'reports_against');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."fraud_signal_status" AS ENUM('open', 'dismissed', 'actioned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_password_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_password_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_sightings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"phone_hmac" text NOT NULL,
	"business_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fraud_scan_state" (
	"rule" text PRIMARY KEY NOT NULL,
	"last_seq" bigint,
	"last_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fraud_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "fraud_signal_kind" NOT NULL,
	"status" "fraud_signal_status" DEFAULT 'open' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"reviewed_by_admin_id" uuid,
	"reviewed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "install_sightings" (
	"install_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "install_sightings_install_hash_user_id_pk" PRIMARY KEY("install_hash","user_id")
);
--> statement-breakpoint
ALTER TABLE "admin_users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "token_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "password_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "deactivated_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "created_by_admin_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_password_tokens" ADD CONSTRAINT "admin_password_tokens_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_password_tokens" ADD CONSTRAINT "admin_password_tokens_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_sightings" ADD CONSTRAINT "contact_sightings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_sightings" ADD CONSTRAINT "contact_sightings_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_sightings" ADD CONSTRAINT "contact_sightings_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "install_sightings" ADD CONSTRAINT "install_sightings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_password_tokens_admin_created_idx" ON "admin_password_tokens" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_sightings_phone_seen_idx" ON "contact_sightings" USING btree ("phone_hmac","seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_sightings_business_seen_idx" ON "contact_sightings" USING btree ("business_id","seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_sightings_message_phone_uq" ON "contact_sightings" USING btree ("message_id","phone_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fraud_signals_one_open" ON "fraud_signals" USING btree ("business_id","kind") WHERE "fraud_signals"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_signals_status_last_seen_idx" ON "fraud_signals" USING btree ("status","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_signals_business_kind_idx" ON "fraud_signals" USING btree ("business_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "install_sightings_last_seen_idx" ON "install_sightings" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "install_sightings_user_idx" ON "install_sightings" USING btree ("user_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_deactivated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("deactivated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "audit_log" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_admin_created_idx" ON "audit_log" USING btree ("admin_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "businesses_created_idx" ON "businesses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_seq_idx" ON "chat_messages" USING btree ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_created_idx" ON "chat_threads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_accepted_idx" ON "deals" USING btree ("accepted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_status_history_to_status_created_idx" ON "listing_status_history" USING btree ("to_status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_opening_created_idx" ON "offers" USING btree ("created_at") WHERE "offers"."round" = 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "part_requests_first_posted_idx" ON "part_requests" USING btree ("first_posted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_bookings_confirmed_idx" ON "rental_bookings" USING btree ("confirmed_at");