ALTER TYPE "public"."connection_scope" ADD VALUE 'instance';--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" text DEFAULT 'default' NOT NULL,
	"public_url" text,
	"tailscale_url" text,
	"tailscale_hostname" text,
	"github_app_slug" text,
	"github_app_id" text,
	"onboarding_completed_at" timestamp with time zone,
	"onboarding_skipped_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_settings_singleton_unique_idx" ON "instance_settings" USING btree ("singleton");