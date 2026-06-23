ALTER TABLE "provider_connections" ADD COLUMN IF NOT EXISTS "priority" integer;
--> statement-breakpoint
ALTER TABLE "provider_connections" ALTER COLUMN "priority" SET DEFAULT 0;
--> statement-breakpoint
UPDATE "provider_connections" SET "priority" = 0 WHERE "priority" IS NULL;
--> statement-breakpoint
ALTER TABLE "provider_connections" ALTER COLUMN "priority" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."contact_reason" AS ENUM('general', 'support', 'partnership', 'feedback', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."contact_status" AS ENUM('new', 'read', 'responded', 'archived');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_submissions" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "email" varchar(255) NOT NULL,
 "reason" "public"."contact_reason" NOT NULL,
 "message" text NOT NULL,
 "status" "public"."contact_status" DEFAULT 'new' NOT NULL,
 "ip_address" varchar(45),
 "created_at" timestamp with time zone DEFAULT now() NOT NULL,
 "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_submissions_status_created_idx" ON "contact_submissions" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_submissions_email_idx" ON "contact_submissions" USING btree ("email");
