CREATE TABLE "data_backfills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"checksum" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processed_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_backfills_status_check" CHECK ("data_backfills"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "data_backfills_key_unique_idx" ON "data_backfills" USING btree ("key");--> statement-breakpoint
CREATE INDEX "data_backfills_status_idx" ON "data_backfills" USING btree ("status");