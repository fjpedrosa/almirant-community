ALTER TYPE "public"."health_service" ADD VALUE IF NOT EXISTS 'vps';--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"max_upload_size_mb" integer DEFAULT 50 NOT NULL,
	"default_locale" varchar(10) DEFAULT 'es' NOT NULL,
	"allow_new_registrations" boolean DEFAULT true NOT NULL,
	"session_timeout_minutes" integer DEFAULT 1440 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;