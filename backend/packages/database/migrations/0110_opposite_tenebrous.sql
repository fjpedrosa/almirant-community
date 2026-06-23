ALTER TABLE "worker_registrations" ADD COLUMN "is_draining" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_registrations" ADD COLUMN "available_slots" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_registrations" ADD COLUMN "system_metrics" jsonb;