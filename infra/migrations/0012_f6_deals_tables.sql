DO $$ BEGIN
 CREATE TYPE "public"."consent_kind" AS ENUM('grant', 'withdraw');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deal_actor_side" AS ENUM('buyer', 'seller', 'system', 'support');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deal_cancelled_by" AS ENUM('buyer', 'seller', 'both', 'system');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deal_completed_how" AS ENUM('buyer_confirmed', 'auto', 'support');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deal_fulfilment" AS ENUM('pickup', 'delivery');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deal_payment_method" AS ENUM('bank', 'upi', 'cash', 'credit');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deal_status" AS ENUM('agreed', 'handed_over', 'completed', 'cancelled', 'disputed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."delivery_state" AS ENUM('queued', 'sent', 'sent_dev', 'failed', 'skipped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."device_platform" AS ENUM('android', 'ios');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."dispute_outcome" AS ENUM('completed', 'cancelled', 'resumed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."hold_status" AS ENUM('active', 'converted', 'released');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."message_kind" AS ENUM('text', 'photos', 'enquiry', 'offer', 'deal', 'system');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_category" AS ENUM('chat', 'offers', 'deals', 'reviews');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."offer_kind" AS ENUM('offer', 'buy_now', 'quote');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."offer_status" AS ENUM('pending', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn', 'backup', 'closed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."party_side" AS ENUM('buyer', 'seller');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "report_target" ADD VALUE 'review';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_blocks" (
	"blocker_business_id" uuid NOT NULL,
	"blocked_business_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_blocks_pk" PRIMARY KEY("blocker_business_id","blocked_business_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"kind" "message_kind" NOT NULL,
	"sender_side" "party_side",
	"sender_user_id" uuid,
	"text" text,
	"quick_options" text[],
	"enquiry_quantity" numeric(14, 3),
	"fit_machine" jsonb,
	"photo_keys" text[],
	"offer_id" uuid,
	"deal_id" uuid,
	"system_code" text,
	"system_values" jsonb,
	"scam_flag" boolean DEFAULT false NOT NULL,
	"client_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_thread_user_state" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_thread_user_state_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_business_id" uuid NOT NULL,
	"seller_business_id" uuid NOT NULL,
	"listing_kind" "listing_kind" NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"last_message_seq" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seller_reply_at" timestamp with time zone,
	"deal_count" integer DEFAULT 0 NOT NULL,
	"buyer_turn" boolean DEFAULT false NOT NULL,
	"seller_turn" boolean DEFAULT false NOT NULL,
	"last_buyer_seq" bigint DEFAULT 0 NOT NULL,
	"last_seller_seq" bigint DEFAULT 0 NOT NULL,
	"contact_unlocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_share_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "consent_kind" NOT NULL,
	"thread_id" uuid,
	"business_id" uuid NOT NULL,
	"user_id" uuid,
	"phone_shown" text NOT NULL,
	"phone_source" text NOT NULL,
	"wording_version" smallint NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"opened_by_side" "party_side" NOT NULL,
	"opened_by_user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"photo_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"outcome" "dispute_outcome",
	"message_to_parties" text,
	"internal_note" text,
	"resolved_by_admin_id" uuid,
	"stock_returned" boolean,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"code" text NOT NULL,
	"actor_side" "deal_actor_side" NOT NULL,
	"actor_user_id" uuid,
	"actor_admin_id" uuid,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deal_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"reviewer_side" "party_side" NOT NULL,
	"reviewer_business_id" uuid NOT NULL,
	"reviewed_business_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"r_matched_listing" smallint,
	"r_communication" smallint,
	"r_on_time" smallint,
	"r_payment" smallint,
	"r_pickup" smallint,
	"text" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"publish_due_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_by_admin_id" uuid,
	"hidden_reason" text,
	"reply_text" text,
	"reply_user_id" uuid,
	"reply_at" timestamp with time zone,
	"reply_hidden_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" bigserial NOT NULL,
	"thread_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"buyer_business_id" uuid NOT NULL,
	"seller_business_id" uuid NOT NULL,
	"listing_title" text NOT NULL,
	"unit_id" uuid,
	"unit_label" text NOT NULL,
	"gst_mode" "gst_price_mode",
	"price_per_unit_paise" bigint NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"total_paise" bigint NOT NULL,
	"status" "deal_status" DEFAULT 'agreed' NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by_user_id" uuid NOT NULL,
	"handed_over_at" timestamp with time zone,
	"handed_over_by_user_id" uuid,
	"handover_photo_key" text,
	"handover_note" text,
	"problem_deadline_at" timestamp with time zone,
	"auto_complete_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_how" "deal_completed_how",
	"cancelled_at" timestamp with time zone,
	"cancelled_by_side" "deal_cancelled_by",
	"cancel_reason" text,
	"cancel_note" text,
	"cancel_requested_side" "party_side",
	"cancel_requested_at" timestamp with time zone,
	"cancel_requested_reason" text,
	"cancel_requested_by_user_id" uuid,
	"payment_method" "deal_payment_method",
	"advance_paise" bigint,
	"fulfilment" "deal_fulfilment",
	"expected_on" date,
	"notes_text" text,
	"notes_scam_flag" boolean DEFAULT false NOT NULL,
	"notes_updated_at" timestamp with time zone,
	"notes_updated_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"agreed_reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_ref_unique" UNIQUE("ref"),
	CONSTRAINT "deals_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" smallint NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"device_id" uuid NOT NULL,
	"state" "delivery_state" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"category" "notification_category" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thread_id" uuid,
	"offer_id" uuid,
	"deal_id" uuid,
	"review_id" uuid,
	"dedupe_key" text NOT NULL,
	"unread_count" smallint DEFAULT 1 NOT NULL,
	"last_seq" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_business_id" uuid NOT NULL,
	"seller_business_id" uuid NOT NULL,
	"negotiation_id" uuid NOT NULL,
	"previous_offer_id" uuid,
	"round" smallint DEFAULT 0 NOT NULL,
	"kind" "offer_kind" NOT NULL,
	"sender_side" "party_side" NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"turn" "party_side" NOT NULL,
	"needs_reconfirm" boolean DEFAULT false NOT NULL,
	"price_per_unit_paise" bigint NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"total_paise" bigint NOT NULL,
	"asking_price_paise" bigint,
	"unit_id" uuid,
	"gst_mode" "gst_price_mode",
	"validity_hours" smallint NOT NULL,
	"expires_at" timestamp with time zone,
	"backup_since" timestamp with time zone,
	"note" text,
	"scam_flag" boolean DEFAULT false NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"close_reason" text,
	"answered_at" timestamp with time zone,
	"answered_by_user_id" uuid,
	"reject_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"status" "hold_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "stock_holds_deal_id_unique" UNIQUE("deal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"install_id" text NOT NULL,
	"fcm_token" text NOT NULL,
	"platform" "device_platform" NOT NULL,
	"app_version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_devices_install_id_unique" UNIQUE("install_id")
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "contact_phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "held_quantity" numeric(14, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_blocks" ADD CONSTRAINT "business_blocks_blocker_business_id_businesses_id_fk" FOREIGN KEY ("blocker_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_blocks" ADD CONSTRAINT "business_blocks_blocked_business_id_businesses_id_fk" FOREIGN KEY ("blocked_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "business_blocks" ADD CONSTRAINT "business_blocks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_thread_user_state" ADD CONSTRAINT "chat_thread_user_state_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_thread_user_state" ADD CONSTRAINT "chat_thread_user_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_buyer_business_id_businesses_id_fk" FOREIGN KEY ("buyer_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_seller_business_id_businesses_id_fk" FOREIGN KEY ("seller_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_share_consents" ADD CONSTRAINT "contact_share_consents_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_share_consents" ADD CONSTRAINT "contact_share_consents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_share_consents" ADD CONSTRAINT "contact_share_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_disputes" ADD CONSTRAINT "deal_disputes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_disputes" ADD CONSTRAINT "deal_disputes_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_disputes" ADD CONSTRAINT "deal_disputes_resolved_by_admin_id_admin_users_id_fk" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_actor_admin_id_admin_users_id_fk" FOREIGN KEY ("actor_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_reviewer_business_id_businesses_id_fk" FOREIGN KEY ("reviewer_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_reviewed_business_id_businesses_id_fk" FOREIGN KEY ("reviewed_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_hidden_by_admin_id_admin_users_id_fk" FOREIGN KEY ("hidden_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_reply_user_id_users_id_fk" FOREIGN KEY ("reply_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_buyer_business_id_businesses_id_fk" FOREIGN KEY ("buyer_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_seller_business_id_businesses_id_fk" FOREIGN KEY ("seller_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_handed_over_by_user_id_users_id_fk" FOREIGN KEY ("handed_over_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_cancel_requested_by_user_id_users_id_fk" FOREIGN KEY ("cancel_requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "deals" ADD CONSTRAINT "deals_notes_updated_by_user_id_users_id_fk" FOREIGN KEY ("notes_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_device_id_user_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."user_devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_review_id_deal_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."deal_reviews"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_buyer_business_id_businesses_id_fk" FOREIGN KEY ("buyer_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_seller_business_id_businesses_id_fk" FOREIGN KEY ("seller_business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_previous_offer_id_offers_id_fk" FOREIGN KEY ("previous_offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_answered_by_user_id_users_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_holds" ADD CONSTRAINT "stock_holds_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_blocks_blocked_idx" ON "business_blocks" USING btree ("blocked_business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_thread_seq_idx" ON "chat_messages" USING btree ("thread_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_client_id_uq" ON "chat_messages" USING btree ("sender_user_id","client_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_thread_user_state_user_idx" ON "chat_thread_user_state" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_threads_listing_buyer_uq" ON "chat_threads" USING btree ("listing_id","buyer_business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_buyer_inbox_idx" ON "chat_threads" USING btree ("buyer_business_id","last_message_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_seller_inbox_idx" ON "chat_threads" USING btree ("seller_business_id","last_message_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_buyer_turn_idx" ON "chat_threads" USING btree ("buyer_business_id") WHERE "chat_threads"."buyer_turn";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_seller_turn_idx" ON "chat_threads" USING btree ("seller_business_id") WHERE "chat_threads"."seller_turn";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_share_consents_thread_business_idx" ON "contact_share_consents" USING btree ("thread_id","business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_share_consents_business_phone_idx" ON "contact_share_consents" USING btree ("business_id","phone_shown","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_disputes_one_open" ON "deal_disputes" USING btree ("deal_id") WHERE "deal_disputes"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_disputes_status_created_idx" ON "deal_disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_events_deal_created_idx" ON "deal_events" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "deal_reviews_deal_side_uq" ON "deal_reviews" USING btree ("deal_id","reviewer_side");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_reviews_published_visible_idx" ON "deal_reviews" USING btree ("reviewed_business_id","reviewer_side") WHERE "deal_reviews"."published_at" IS NOT NULL AND "deal_reviews"."hidden_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_reviews_unpublished_idx" ON "deal_reviews" USING btree ("publish_due_at") WHERE "deal_reviews"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_buyer_status_updated_idx" ON "deals" USING btree ("buyer_business_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_seller_status_updated_idx" ON "deals" USING btree ("seller_business_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_handed_over_due_idx" ON "deals" USING btree ("status","auto_complete_at") WHERE "deals"."status" = 'handed_over';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_open_per_listing_idx" ON "deals" USING btree ("listing_id") WHERE "deals"."status" IN ('agreed', 'handed_over', 'disputed');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_thread_idx" ON "deals" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_uq" ON "notification_deliveries" USING btree ("notification_id","version","device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_deliveries_state_due_idx" ON "notification_deliveries" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_open_chat_row" ON "notifications" USING btree ("user_id","thread_id") WHERE "notifications"."type" = 'message_new' AND "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offers_one_open_per_thread" ON "offers" USING btree ("thread_id") WHERE "offers"."status" IN ('pending', 'backup');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_listing_status_idx" ON "offers" USING btree ("listing_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_pending_expiry_idx" ON "offers" USING btree ("status","expires_at") WHERE "offers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_buyer_status_idx" ON "offers" USING btree ("buyer_business_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_negotiation_idx" ON "offers" USING btree ("negotiation_id","round");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_thread_idx" ON "offers" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_holds_active_listing_idx" ON "stock_holds" USING btree ("listing_id") WHERE "stock_holds"."status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_devices_user_idx" ON "user_devices" USING btree ("user_id");