CREATE TABLE "agent_job_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"work_item_id" uuid,
	"seq" integer NOT NULL,
	"level" varchar(16) DEFAULT 'info' NOT NULL,
	"phase" varchar(64) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_job_logs" ADD CONSTRAINT "agent_job_logs_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_logs" ADD CONSTRAINT "agent_job_logs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_logs" ADD CONSTRAINT "agent_job_logs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_logs_job_seq_unique_idx" ON "agent_job_logs" USING btree ("job_id","seq");--> statement-breakpoint
CREATE INDEX "agent_job_logs_job_timestamp_idx" ON "agent_job_logs" USING btree ("job_id","timestamp");--> statement-breakpoint
CREATE INDEX "agent_job_logs_timestamp_idx" ON "agent_job_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "agent_job_logs_work_item_idx" ON "agent_job_logs" USING btree ("work_item_id");