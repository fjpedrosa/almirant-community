-- Expand agent_job_type enum with 'incident-analyze'
ALTER TYPE "public"."agent_job_type" ADD VALUE IF NOT EXISTS 'incident-analyze';

-- Incident bundles table (Pieza 3 — debug infrastructure)
CREATE TABLE IF NOT EXISTS "incident_bundles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feedback_item_id" uuid REFERENCES "feedback_items"("id") ON DELETE CASCADE,
  "agent_job_id" uuid REFERENCES "agent_jobs"("id") ON DELETE SET NULL,
  "trace_id" varchar(64),
  "organization_id" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "incident_bundles_feedback_idx" ON "incident_bundles" ("feedback_item_id");
CREATE INDEX IF NOT EXISTS "incident_bundles_job_idx" ON "incident_bundles" ("agent_job_id");
CREATE INDEX IF NOT EXISTS "incident_bundles_trace_idx" ON "incident_bundles" ("trace_id");
