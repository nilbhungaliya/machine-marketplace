DO $$ BEGIN
 CREATE TYPE "public"."catalog_level" AS ENUM('machine_category', 'machine_type', 'part_group');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."catalog_status" AS ENUM('active', 'retired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."field_applies_to" AS ENUM('parts', 'machines', 'both');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."field_type" AS ENUM('single_select', 'multi_select', 'number', 'text', 'date');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"makes_machines" boolean DEFAULT true NOT NULL,
	"makes_parts" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_key_unique" UNIQUE("key"),
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"level" "catalog_level" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"has_sides" boolean,
	"side_convention" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conditions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "machine_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"machine_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_models_brand_key_uq" UNIQUE("brand_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "catalog_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_field_options_field_key_uq" UNIQUE("field_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"type" "field_type" NOT NULL,
	"applies_to" "field_applies_to" DEFAULT 'both' NOT NULL,
	"unit" text,
	"min" numeric(14, 3),
	"max" numeric(14, 3),
	"required" boolean DEFAULT false NOT NULL,
	"filterable" boolean DEFAULT false NOT NULL,
	"highlight_rank" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "catalog_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_fields_category_key_uq" UNIQUE("category_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"decimals" smallint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_key_unique" UNIQUE("key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "machine_models" ADD CONSTRAINT "machine_models_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "machine_models" ADD CONSTRAINT "machine_models_machine_type_id_categories_id_fk" FOREIGN KEY ("machine_type_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_field_options" ADD CONSTRAINT "template_field_options_field_id_template_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."template_fields"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "machine_models_brand_type_name_uq" ON "machine_models" USING btree ("brand_id","machine_type_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machine_models_machine_type_id_idx" ON "machine_models" USING btree ("machine_type_id");