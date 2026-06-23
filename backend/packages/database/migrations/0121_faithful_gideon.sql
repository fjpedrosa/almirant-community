DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'worker_lifecycle_event_type') THEN CREATE TYPE "public"."worker_lifecycle_event_type" AS ENUM('started', 'stopped', 'ip_changed', 'draining_started', 'draining_stopped'); END IF; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "worker_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_name" text NOT NULL,
	"event_type" "worker_lifecycle_event_type" NOT NULL,
	"ip" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "worker_registrations" ADD COLUMN IF NOT EXISTS "current_ip" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_lifecycle_events_worker_name_idx" ON "worker_lifecycle_events" USING btree ("worker_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_lifecycle_events_event_type_idx" ON "worker_lifecycle_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_lifecycle_events_created_at_idx" ON "worker_lifecycle_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worker_registrations_hostname_unique_idx" ON "worker_registrations" USING btree ("hostname");
