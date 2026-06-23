DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_account_type') THEN CREATE TYPE "public"."service_account_type" AS ENUM('runner', 'integration'); END IF; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "service_account_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_accounts_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "worker_registrations" ADD COLUMN IF NOT EXISTS "ram_budget_mb" integer;--> statement-breakpoint
ALTER TABLE "worker_registrations" ADD COLUMN IF NOT EXISTS "ram_committed_mb" integer;--> statement-breakpoint
ALTER TABLE "worker_registrations" ADD COLUMN IF NOT EXISTS "ram_available_mb" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "service_account_id" uuid;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_accounts_organization_id_idx" ON "service_accounts" USING btree ("organization_id");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_service_account_id_idx" ON "api_keys" USING btree ("service_account_id");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_owner_check" CHECK ("user_id" IS NOT NULL OR "service_account_id" IS NOT NULL); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
