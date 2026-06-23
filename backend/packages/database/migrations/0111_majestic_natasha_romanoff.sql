CREATE TABLE "worker_metrics_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"cpu_percent" numeric,
	"ram_percent" numeric,
	"ram_used_mb" integer,
	"ram_total_mb" integer,
	"active_jobs" integer,
	"container_metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "worker_metrics_worker_timestamp_idx" ON "worker_metrics_history" USING btree ("worker_id","timestamp");--> statement-breakpoint
CREATE INDEX "worker_metrics_timestamp_idx" ON "worker_metrics_history" USING btree ("timestamp");