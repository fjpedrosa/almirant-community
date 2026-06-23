CREATE TABLE "event_archives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planning_session_id" uuid NOT NULL,
	"archive_kind" varchar(64) NOT NULL,
	"storage_bucket" varchar(255),
	"storage_key" text NOT NULL,
	"storage_url" text,
	"format" varchar(32) NOT NULL,
	"compression" varchar(16) DEFAULT 'gzip' NOT NULL,
	"content_type" varchar(128),
	"row_count" integer DEFAULT 0 NOT NULL,
	"last_sequence_num" integer,
	"projector_version" integer,
	"checksum_sha256" varchar(64) NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_archives" ADD CONSTRAINT "event_archives_planning_session_id_planning_sessions_id_fk" FOREIGN KEY ("planning_session_id") REFERENCES "public"."planning_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "event_archives_session_kind_unique_idx" ON "event_archives" USING btree ("planning_session_id","archive_kind");
--> statement-breakpoint
CREATE INDEX "event_archives_session_idx" ON "event_archives" USING btree ("planning_session_id");
--> statement-breakpoint
CREATE INDEX "event_archives_kind_archived_at_idx" ON "event_archives" USING btree ("archive_kind","archived_at");
