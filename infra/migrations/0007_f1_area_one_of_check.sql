ALTER TABLE "businesses" ADD CONSTRAINT "businesses_area_one_of" CHECK ("industrial_area_id" IS NULL OR "industrial_area_other" IS NULL);--> statement-breakpoint
DROP TYPE IF EXISTS "public"."business_role";
