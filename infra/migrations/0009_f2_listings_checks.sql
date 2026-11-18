-- F2 listings (spec 2026-11-18-f2-f3 §13.2, §13.3): what drizzle-kit 0.22 can't emit. CHECKs, the listing reference
-- sequence restart (#100001, R35) and the machine-unit flag on an existing `machines` unit (R48).
ALTER TABLE "listings" ADD CONSTRAINT "listings_quantity_positive" CHECK ("quantity" IS NULL OR "quantity" > 0);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_min_order_positive" CHECK ("min_order_qty" IS NULL OR "min_order_qty" > 0);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_price_positive" CHECK ("price_paise" IS NULL OR "price_paise" > 0);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_area_one_of" CHECK ("industrial_area_id" IS NULL OR "industrial_area_other" IS NULL);--> statement-breakpoint
ALTER TABLE "listing_machines" ADD CONSTRAINT "listing_machines_brand_one_of" CHECK ("brand_id" IS NULL OR "brand_other" IS NULL);--> statement-breakpoint
ALTER TABLE "listing_machines" ADD CONSTRAINT "listing_machines_model_one_of" CHECK ("model_id" IS NULL OR "model_other" IS NULL);--> statement-breakpoint
ALTER TABLE "listing_fitments" ADD CONSTRAINT "listing_fitments_model_one_of" CHECK ("model_id" IS NULL OR "model_other" IS NULL);--> statement-breakpoint
ALTER TABLE "listing_fitments" ADD CONSTRAINT "listing_fitments_years_order" CHECK ("year_from" IS NULL OR "year_to" IS NULL OR "year_from" <= "year_to");--> statement-breakpoint
ALTER TABLE "listing_rentals" ADD CONSTRAINT "listing_rentals_money_positive" CHECK (
  ("rate_hour_paise" IS NULL OR "rate_hour_paise" > 0)
  AND ("rate_day_paise" IS NULL OR "rate_day_paise" > 0)
  AND ("rate_week_paise" IS NULL OR "rate_week_paise" > 0)
  AND ("rate_month_paise" IS NULL OR "rate_month_paise" > 0)
  AND ("overtime_rate_hour_paise" IS NULL OR "overtime_rate_hour_paise" > 0)
  AND ("operator_rate_day_paise" IS NULL OR "operator_rate_day_paise" > 0)
  AND ("transport_charge_paise" IS NULL OR "transport_charge_paise" > 0)
  AND ("deposit_paise" IS NULL OR "deposit_paise" > 0)
);--> statement-breakpoint
ALTER TABLE "listing_rentals" ADD CONSTRAINT "listing_rentals_shift_hours_range" CHECK ("shift_hours" BETWEEN 1 AND 24);--> statement-breakpoint
ALTER TABLE "listing_rentals" ADD CONSTRAINT "listing_rentals_month_days_range" CHECK ("month_days" BETWEEN 1 AND 31);--> statement-breakpoint
ALTER SEQUENCE "listings_ref_seq" RESTART WITH 100001;--> statement-breakpoint
UPDATE "units" SET "is_machine_unit" = true WHERE "key" = 'machines';
