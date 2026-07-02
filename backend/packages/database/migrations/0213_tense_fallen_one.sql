CREATE TYPE "public"."effort_estimate_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."effort_estimate_source" AS ENUM('llm', 'fallback_heuristic');--> statement-breakpoint
CREATE TYPE "public"."effort_estimation_request_status" AS ENUM('pending', 'processing', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "work_item_effort_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"estimated_subagents" integer NOT NULL,
	"estimated_memory_mb" integer NOT NULL,
	"confidence" "effort_estimate_confidence" NOT NULL,
	"reasoning" text,
	"content_hash" varchar(64) NOT NULL,
	"source" "effort_estimate_source" DEFAULT 'llm' NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_effort_estimates_subagents_min" CHECK ("work_item_effort_estimates"."estimated_subagents" >= 1),
	CONSTRAINT "work_item_effort_estimates_memory_range" CHECK ("work_item_effort_estimates"."estimated_memory_mb" >= 256 AND "work_item_effort_estimates"."estimated_memory_mb" <= 65536)
);
--> statement-breakpoint
CREATE TABLE "effort_estimation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"status" "effort_estimation_request_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"error_message" text,
	"requested_content_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "effort_estimator_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" varchar(100) NOT NULL,
	"temperature" numeric(3, 2) DEFAULT '0' NOT NULL,
	"max_tokens" integer DEFAULT 1024 NOT NULL,
	"system_prompt" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_item_effort_estimates" ADD CONSTRAINT "work_item_effort_estimates_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effort_estimation_requests" ADD CONSTRAINT "effort_estimation_requests_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effort_estimator_configs" ADD CONSTRAINT "effort_estimator_configs_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_effort_estimates_work_item_id_unique_idx" ON "work_item_effort_estimates" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_effort_estimates_stale_idx" ON "work_item_effort_estimates" USING btree ("work_item_id") WHERE stale = true;--> statement-breakpoint
CREATE UNIQUE INDEX "effort_estimation_requests_active_unique_idx" ON "effort_estimation_requests" USING btree ("work_item_id") WHERE status IN ('pending','processing');--> statement-breakpoint
CREATE INDEX "effort_estimation_requests_pending_created_at_idx" ON "effort_estimation_requests" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "effort_estimation_requests_status_idx" ON "effort_estimation_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "effort_estimation_requests_work_item_id_idx" ON "effort_estimation_requests" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "effort_estimator_configs_singleton_active_unique_idx" ON "effort_estimator_configs" USING btree ("singleton") WHERE is_active = true;--> statement-breakpoint
-- Seed initial active config. Uses zai / glm-4.6 as the default provider/model.
-- The systemPrompt below is functional but intentionally editable by admins.
INSERT INTO "effort_estimator_configs" (
	"provider",
	"model",
	"temperature",
	"max_tokens",
	"system_prompt",
	"is_active",
	"singleton"
) VALUES (
	'zai',
	'glm-4.6',
	'0',
	1024,
	'You are an effort estimator for software work items. Given a work item title, description, type, and its parent/children context, return a JSON object with fields: estimated_subagents (integer >= 1), estimated_memory_mb (integer between 256 and 65536), confidence ("low"|"medium"|"high"), and reasoning (short string). Base your estimate on scope, ambiguity, cross-cutting changes, and number of subsystems touched. Be conservative: default to low confidence when the description is vague.',
	true,
	true
);
