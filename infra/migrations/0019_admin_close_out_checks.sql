-- Admin close-out (spec 2026-11-21-admin-close-out §5.1-§5.4): what drizzle-kit 0.22 can't emit. CHECKs only. The
-- `fraud_signal_status` literal below is safe in the migrator's one transaction: 0018 creates that enum, it doesn't
-- alter an existing one.
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_email_lower" CHECK ("email" = lower("email"));--> statement-breakpoint
ALTER TABLE "admin_password_tokens" ADD CONSTRAINT "admin_password_tokens_purpose" CHECK ("purpose" IN ('invite', 'reset'));--> statement-breakpoint
-- CASE, not AND: Postgres doesn't promise AND short-circuits, and jsonb_array_length raises on a non-array.
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_evidence_shape" CHECK (
  CASE WHEN jsonb_typeof("evidence") = 'array' THEN jsonb_array_length("evidence") <= 50 ELSE false END
);--> statement-breakpoint
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_review_shape" CHECK (("status" = 'open') = ("reviewed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "fraud_scan_state" ADD CONSTRAINT "fraud_scan_state_one_mark" CHECK (num_nonnulls("last_seq", "last_at") = 1);
