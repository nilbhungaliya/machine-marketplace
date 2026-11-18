ALTER TABLE "units" ADD CONSTRAINT "units_decimals_range" CHECK ("decimals" BETWEEN 0 AND 3);
