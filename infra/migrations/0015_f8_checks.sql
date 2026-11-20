-- F8 part requests (spec 2026-11-20-f8-part-requests §5.10): what drizzle-kit 0.22 can't emit. CHECKs and the
-- request reference sequence (#300001). Nothing here uses the enum values 0014 adds to existing enums
-- (`notification_category` 'requests', `report_target` 'part_request'): Postgres refuses a new value in the
-- transaction that adds it.
ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_quantity_positive" CHECK ("quantity" > 0);--> statement-breakpoint
ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_budget_positive" CHECK ("budget_per_unit_paise" IS NULL OR "budget_per_unit_paise" > 0);--> statement-breakpoint
ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_note_len" CHECK ("note" IS NULL OR char_length("note") <= 500);--> statement-breakpoint
ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_photos_max" CHECK (cardinality("photo_keys") <= 3);--> statement-breakpoint
ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_machine_shape" CHECK ("kind" <> 'machine' OR ("side" IS NULL AND "part_number" IS NULL));--> statement-breakpoint
ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_closed_reason" CHECK ("status" <> 'closed' OR "close_reason" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "part_requests" ADD CONSTRAINT "part_requests_removed_at" CHECK ("status" <> 'removed' OR "removed_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "part_request_replies" ADD CONSTRAINT "part_request_replies_message_len" CHECK ("message" IS NULL OR char_length("message") <= 300);--> statement-breakpoint
ALTER TABLE "part_request_fitments" ADD CONSTRAINT "part_request_fitments_years" CHECK ("year_from" IS NULL OR "year_to" IS NULL OR "year_from" <= "year_to");--> statement-breakpoint
ALTER SEQUENCE "part_requests_ref_seq" RESTART WITH 300001;
