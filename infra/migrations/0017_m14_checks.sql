-- M14 rental bookings (spec 2026-11-20-m14-rental-bookings §5.1-§5.6): what drizzle-kit 0.22 can't emit. CHECKs, the
-- review / dispute subject rules, the rewritten `deal_reviews_shape` and `chat_messages_shape`, and the booking
-- reference sequence (#700001). Nothing here compares the values 0016 adds to existing enums (`message_kind`
-- 'booking', `notification_category` 'rentals') as enum literals: Postgres refuses a new value in the transaction that
-- adds it, and the migrator runs 0016 + 0017 in one transaction. `chat_messages_shape` therefore switches on
-- "kind"::text. The new enums (`rental_booking_status`…) are created, not altered, by 0016: their literals are fine.
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_dates" CHECK ("end_date" >= "start_date");--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_counts" CHECK (
  "machines" BETWEEN 1 AND 1000 AND "period_count" >= 1 AND "change_count" >= 0
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_turn_open" CHECK (
  ("turn" IS NOT NULL) = ("status" IN ('requested', 'countered'))
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_text_lengths" CHECK (
  ("site_address" IS NULL OR char_length("site_address") <= 200)
  AND ("final_amount_note" IS NULL OR char_length("final_amount_note") <= 300)
  AND ("cancel_note" IS NULL OR char_length("cancel_note") <= 300)
  AND ("damage_note" IS NULL OR char_length("damage_note") <= 500)
  AND ("notes_text" IS NULL OR char_length("notes_text") <= 500)
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_money" CHECK (
  ("agreed_total_paise" IS NULL OR "agreed_total_paise" BETWEEN 0 AND 10000000000)
  AND ("final_amount_paise" IS NULL OR "final_amount_paise" BETWEEN 0 AND 10000000000)
  AND ("deposit_paise" IS NULL OR "deposit_paise" BETWEEN 0 AND 10000000000)
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_advance_le_agreed" CHECK (
  "advance_paise" IS NULL
  OR ("advance_paise" >= 0 AND "agreed_total_paise" IS NOT NULL AND "advance_paise" <= "agreed_total_paise")
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_hour_meters" CHECK (
  ("hour_meter_start" IS NULL OR "hour_meter_start" BETWEEN 0 AND 1000000)
  AND ("hour_meter_end" IS NULL OR "hour_meter_end" BETWEEN 0 AND 1000000)
  AND ("hour_meter_start" IS NULL OR "hour_meter_end" IS NULL OR "hour_meter_end" >= "hour_meter_start")
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_photos_max" CHECK (
  cardinality("on_site_photo_keys") <= 3 AND cardinality("return_photo_keys") <= 3
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_sides" CHECK (
  ("on_site_by_side" IS NULL OR "on_site_by_side" IN ('renter', 'owner'))
  AND ("disputed_from" IS NULL OR "disputed_from" IN ('on_rent', 'returned'))
);--> statement-breakpoint
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_expected_time" CHECK (
  "expected_on_site_time" IS NULL OR "expected_on_site_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
);--> statement-breakpoint
ALTER TABLE "rental_booking_versions" ADD CONSTRAINT "rental_booking_versions_shape" CHECK (
  "seq" >= 1 AND "end_date" >= "start_date" AND "machines" BETWEEN 1 AND 1000 AND "period_count" >= 1
  AND "estimate_paise" BETWEEN 0 AND 10000000000 AND "total_paise" BETWEEN 0 AND 10000000000
  AND ("message" IS NULL OR char_length("message") <= 500)
);--> statement-breakpoint
ALTER TABLE "rental_blocks" ADD CONSTRAINT "rental_blocks_shape" CHECK (
  "end_date" >= "start_date" AND "end_date" - "start_date" <= 365 AND "machines" BETWEEN 1 AND 1000
  AND ("note" IS NULL OR char_length("note") <= 200)
);--> statement-breakpoint
ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_subject_one" CHECK (num_nonnulls("deal_id", "rental_booking_id") = 1);--> statement-breakpoint
ALTER TABLE "deal_disputes" ADD CONSTRAINT "deal_disputes_subject_one" CHECK (num_nonnulls("deal_id", "rental_booking_id") = 1);--> statement-breakpoint
ALTER TABLE "deal_reviews" DROP CONSTRAINT "deal_reviews_shape";--> statement-breakpoint
ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_shape" CHECK (
  CASE
    WHEN "rental_booking_id" IS NULL THEN
      CASE "reviewer_side"
        WHEN 'buyer' THEN "r_matched_listing" BETWEEN 1 AND 5 AND "r_communication" BETWEEN 1 AND 5
          AND "r_on_time" BETWEEN 1 AND 5 AND "r_payment" IS NULL AND "r_pickup" IS NULL AND "r_care" IS NULL
        WHEN 'seller' THEN "r_communication" BETWEEN 1 AND 5 AND "r_payment" BETWEEN 1 AND 5
          AND "r_pickup" BETWEEN 1 AND 5 AND "r_matched_listing" IS NULL AND "r_on_time" IS NULL AND "r_care" IS NULL
          AND "text" IS NULL
        ELSE false
      END
    ELSE
      CASE "reviewer_side"
        WHEN 'buyer' THEN "r_matched_listing" BETWEEN 1 AND 5 AND "r_communication" BETWEEN 1 AND 5
          AND "r_on_time" BETWEEN 1 AND 5 AND "r_payment" IS NULL AND "r_pickup" IS NULL AND "r_care" IS NULL
        WHEN 'seller' THEN "r_communication" BETWEEN 1 AND 5 AND "r_payment" BETWEEN 1 AND 5
          AND "r_care" BETWEEN 1 AND 5 AND "r_matched_listing" IS NULL AND "r_on_time" IS NULL AND "r_pickup" IS NULL
          AND "text" IS NULL
        ELSE false
      END
  END
);--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_shape";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_shape" CHECK (
  CASE "kind"::text
    WHEN 'text' THEN "sender_side" IS NOT NULL AND "text" IS NOT NULL
      AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL AND "fit_machine" IS NULL
      AND "offer_id" IS NULL AND "deal_id" IS NULL AND "rental_booking_id" IS NULL
      AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'photos' THEN "sender_side" IS NOT NULL AND "photo_keys" IS NOT NULL AND cardinality("photo_keys") >= 1
      AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL AND "fit_machine" IS NULL
      AND "offer_id" IS NULL AND "deal_id" IS NULL AND "rental_booking_id" IS NULL
      AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'enquiry' THEN "sender_side" IS NOT NULL AND "quick_options" IS NOT NULL
      AND "photo_keys" IS NULL AND "offer_id" IS NULL AND "deal_id" IS NULL AND "rental_booking_id" IS NULL
      AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'offer' THEN "sender_side" IS NOT NULL AND "offer_id" IS NOT NULL
      AND "text" IS NULL AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL
      AND "fit_machine" IS NULL AND "deal_id" IS NULL AND "rental_booking_id" IS NULL
      AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'deal' THEN "deal_id" IS NOT NULL
      AND "text" IS NULL AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL
      AND "fit_machine" IS NULL AND "offer_id" IS NULL AND "rental_booking_id" IS NULL
      AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'booking' THEN "sender_side" IS NOT NULL AND "rental_booking_id" IS NOT NULL
      AND "text" IS NULL AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL
      AND "fit_machine" IS NULL AND "offer_id" IS NULL AND "deal_id" IS NULL
      AND "system_code" IS NULL AND "system_values" IS NULL
    -- A booking's system lines may carry its id (M14 §8); every other system line keeps it null by its writer.
    WHEN 'system' THEN "sender_side" IS NULL AND "sender_user_id" IS NULL
      AND "system_code" IS NOT NULL AND "system_values" IS NOT NULL
      AND "text" IS NULL AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL
      AND "fit_machine" IS NULL AND "offer_id" IS NULL AND "deal_id" IS NULL
    ELSE false
  END
);--> statement-breakpoint
ALTER SEQUENCE "rental_bookings_ref_seq" RESTART WITH 700001;
