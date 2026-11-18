UPDATE "businesses" SET "activities" = CASE "role" WHEN 'buy' THEN '{buy}'::text[] WHEN 'sell' THEN '{sell}'::text[] ELSE '{buy,sell}'::text[] END;--> statement-breakpoint
UPDATE "businesses" SET "industrial_area_other" = "industrial_area" WHERE "industrial_area" IS NOT NULL;
