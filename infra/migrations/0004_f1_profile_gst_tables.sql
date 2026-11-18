DO $$ BEGIN
 CREATE TYPE "public"."employees_range" AS ENUM('1-10', '11-50', '51-200', '200+');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gst_check_result" AS ENUM('found', 'held', 'status_refused', 'not_found', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gst_check_source" AS ENUM('business', 'officer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gst_proof_method" AS ENUM('provider_otp', 'documents');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gst_proof_status" AS ENUM('declared', 'code_sent', 'passed', 'waiting', 'needs_more', 'approved', 'rejected', 'spent');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."gst_status" AS ENUM('active', 'cancelled', 'suspended', 'inactive');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."revocation_source" AS ENUM('officer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."verification_level" AS ENUM('phone', 'gst', 'business');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."verification_method" AS ENUM('provider_otp', 'officer_review');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"level" "verification_level" NOT NULL,
	"method" "verification_method",
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"verified_by_admin_id" uuid,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by_admin_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"revocation_source" "revocation_source",
	"verified_by_proof_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gst_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid,
	"gstin" text NOT NULL,
	"source" "gst_check_source" NOT NULL,
	"admin_id" uuid,
	"result" "gst_check_result" NOT NULL,
	"provider_ref" text,
	"gst_status" "gst_status",
	"details" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gst_representative_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"declaration_version" integer NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" "gst_proof_method",
	"status" "gst_proof_status" DEFAULT 'declared' NOT NULL,
	"otp_ref" text,
	"otp_hint" text,
	"otp_sends" integer DEFAULT 0 NOT NULL,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"last_otp_sent_at" timestamp with time zone,
	"passed_at" timestamp with time zone,
	"entered" jsonb,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"officer_id" uuid,
	"officer_message" text,
	"decided_at" timestamp with time zone,
	"reason" text,
	"approved_details" jsonb,
	"lookup_at_approval" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "industrial_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pincode_offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pincode" text NOT NULL,
	"office_name" text NOT NULL,
	"district" text NOT NULL,
	"state" text NOT NULL,
	"point" "geography"
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "activities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "year_established" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "employees" "employees_range";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "industrial_area_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "industrial_area_other" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "constitution" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "gst_registered_on" date;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "gst_address" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_verifications" ADD CONSTRAINT "business_verifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_verifications" ADD CONSTRAINT "business_verifications_verified_by_admin_id_admin_users_id_fk" FOREIGN KEY ("verified_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_verifications" ADD CONSTRAINT "business_verifications_revoked_by_admin_id_admin_users_id_fk" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_verifications" ADD CONSTRAINT "business_verifications_verified_by_proof_id_gst_representative_proofs_id_fk" FOREIGN KEY ("verified_by_proof_id") REFERENCES "public"."gst_representative_proofs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gst_checks" ADD CONSTRAINT "gst_checks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gst_checks" ADD CONSTRAINT "gst_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gst_checks" ADD CONSTRAINT "gst_checks_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gst_representative_proofs" ADD CONSTRAINT "gst_representative_proofs_check_id_gst_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."gst_checks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gst_representative_proofs" ADD CONSTRAINT "gst_representative_proofs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gst_representative_proofs" ADD CONSTRAINT "gst_representative_proofs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gst_representative_proofs" ADD CONSTRAINT "gst_representative_proofs_officer_id_admin_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_verifications_active_uq" ON "business_verifications" USING btree ("business_id","level") WHERE "business_verifications"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gst_checks_business_created_idx" ON "gst_checks" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gst_proofs_status_created_idx" ON "gst_representative_proofs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gst_proofs_business_created_idx" ON "gst_representative_proofs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gst_proofs_one_open_review_uq" ON "gst_representative_proofs" USING btree ("business_id") WHERE "gst_representative_proofs"."status" IN ('waiting', 'needs_more');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "industrial_areas_name_city_state_uq" ON "industrial_areas" USING btree (lower("name"),lower("city"),"state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pincode_offices_pincode_idx" ON "pincode_offices" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pincode_offices_point_idx" ON "pincode_offices" USING gist ("point");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "businesses" ADD CONSTRAINT "businesses_industrial_area_id_industrial_areas_id_fk" FOREIGN KEY ("industrial_area_id") REFERENCES "public"."industrial_areas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "businesses_city_industrial_area_idx" ON "businesses" USING btree ("city","industrial_area_id");