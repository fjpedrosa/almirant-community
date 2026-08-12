CREATE TABLE "agent_job_event_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_job_id" uuid NOT NULL,
	"archive_kind" varchar(64) NOT NULL,
	"storage_bucket" varchar(255),
	"storage_key" text NOT NULL,
	"storage_url" text,
	"format" varchar(32) NOT NULL,
	"compression" varchar(16) DEFAULT 'gzip' NOT NULL,
	"content_type" varchar(128),
	"row_count" integer DEFAULT 0 NOT NULL,
	"last_sequence_num" integer,
	"checksum_sha256" varchar(64) NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_job_event_archives" ADD CONSTRAINT "agent_job_event_archives_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_job_event_archives_job_kind_unique_idx" ON "agent_job_event_archives" USING btree ("agent_job_id","archive_kind");--> statement-breakpoint
CREATE INDEX "agent_job_event_archives_kind_archived_at_idx" ON "agent_job_event_archives" USING btree ("archive_kind","archived_at");