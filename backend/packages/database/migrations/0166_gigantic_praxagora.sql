ALTER TYPE "public"."agent_job_type" ADD VALUE IF NOT EXISTS 'incident-analyze';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE IF NOT EXISTS 'feedback_item';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedback_item_id" uuid,
	"agent_job_id" uuid,
	"trace_id" varchar(64),
	"organization_id" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_bundles" ADD CONSTRAINT "incident_bundles_feedback_item_id_feedback_items_id_fk" FOREIGN KEY ("feedback_item_id") REFERENCES "public"."feedback_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_bundles" ADD CONSTRAINT "incident_bundles_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_bundles" ADD CONSTRAINT "incident_bundles_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_bundles_feedback_idx" ON "incident_bundles" USING btree ("feedback_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_bundles_job_idx" ON "incident_bundles" USING btree ("agent_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_bundles_trace_idx" ON "incident_bundles" USING btree ("trace_id");
