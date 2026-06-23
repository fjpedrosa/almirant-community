CREATE TYPE "public"."contact_reason" AS ENUM('general', 'support', 'partnership', 'feedback', 'other');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('new', 'read', 'responded', 'archived');--> statement-breakpoint
CREATE TABLE "contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"reason" "contact_reason" NOT NULL,
	"message" text NOT NULL,
	"status" "contact_status" DEFAULT 'new' NOT NULL,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contact_submissions_status_created_idx" ON "contact_submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contact_submissions_email_idx" ON "contact_submissions" USING btree ("email");