-- F6 + F7 (spec 2026-11-19-f6-f7 §5, §5.17): what drizzle-kit 0.22 can't emit. CHECKs, F2's quantity CHECK relaxed
-- to allow a sell-out at 0, the deal reference sequence (#500001) and the append-only consent trigger (P5).
-- Nothing here uses the new `report_target` value 'review' (added by 0012 in the same migration run).
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_parties_differ" CHECK ("buyer_business_id" <> "seller_business_id");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_shape" CHECK (
  CASE "kind"
    WHEN 'text' THEN "sender_side" IS NOT NULL AND "text" IS NOT NULL
      AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL AND "fit_machine" IS NULL
      AND "offer_id" IS NULL AND "deal_id" IS NULL AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'photos' THEN "sender_side" IS NOT NULL AND "photo_keys" IS NOT NULL AND cardinality("photo_keys") >= 1
      AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL AND "fit_machine" IS NULL
      AND "offer_id" IS NULL AND "deal_id" IS NULL AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'enquiry' THEN "sender_side" IS NOT NULL AND "quick_options" IS NOT NULL
      AND "photo_keys" IS NULL AND "offer_id" IS NULL AND "deal_id" IS NULL
      AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'offer' THEN "sender_side" IS NOT NULL AND "offer_id" IS NOT NULL
      AND "text" IS NULL AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL
      AND "fit_machine" IS NULL AND "deal_id" IS NULL AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'deal' THEN "deal_id" IS NOT NULL
      AND "text" IS NULL AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL
      AND "fit_machine" IS NULL AND "offer_id" IS NULL AND "system_code" IS NULL AND "system_values" IS NULL
    WHEN 'system' THEN "sender_side" IS NULL AND "sender_user_id" IS NULL
      AND "system_code" IS NOT NULL AND "system_values" IS NOT NULL
      AND "text" IS NULL AND "photo_keys" IS NULL AND "quick_options" IS NULL AND "enquiry_quantity" IS NULL
      AND "fit_machine" IS NULL AND "offer_id" IS NULL AND "deal_id" IS NULL
    ELSE false
  END
);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_photos_max" CHECK ("photo_keys" IS NULL OR cardinality("photo_keys") <= 5);--> statement-breakpoint
ALTER TABLE "deal_disputes" ADD CONSTRAINT "deal_disputes_photos_max" CHECK (cardinality("photo_keys") <= 5);--> statement-breakpoint
ALTER TABLE "deal_reviews" ADD CONSTRAINT "deal_reviews_shape" CHECK (
  CASE "reviewer_side"
    WHEN 'buyer' THEN "r_matched_listing" BETWEEN 1 AND 5 AND "r_communication" BETWEEN 1 AND 5
      AND "r_on_time" BETWEEN 1 AND 5 AND "r_payment" IS NULL AND "r_pickup" IS NULL
    WHEN 'seller' THEN "r_communication" BETWEEN 1 AND 5 AND "r_payment" BETWEEN 1 AND 5
      AND "r_pickup" BETWEEN 1 AND 5 AND "r_matched_listing" IS NULL AND "r_on_time" IS NULL AND "text" IS NULL
    ELSE false
  END
);--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_terms_positive" CHECK ("price_per_unit_paise" > 0 AND "quantity" > 0 AND "total_paise" >= 0);--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_advance_le_total" CHECK ("advance_paise" IS NULL OR ("advance_paise" >= 0 AND "advance_paise" <= "total_paise"));--> statement-breakpoint
ALTER TABLE "listings" DROP CONSTRAINT "listings_quantity_positive";--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" >= 0);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_held_quantity_range" CHECK (
  "held_quantity" >= 0 AND (("quantity" IS NULL AND "held_quantity" = 0) OR "held_quantity" <= "quantity")
);--> statement-breakpoint
ALTER SEQUENCE "deals_ref_seq" RESTART WITH 500001;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "contact_share_consents_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mpm.consent_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'contact_share_consents is append-only' USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contact_share_consents_append_only"
  BEFORE UPDATE OR DELETE ON "contact_share_consents"
  FOR EACH ROW EXECUTE FUNCTION "contact_share_consents_append_only"();
