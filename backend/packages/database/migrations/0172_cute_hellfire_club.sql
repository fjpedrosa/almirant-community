CREATE TYPE "public"."memory_created_by_kind" AS ENUM('agent', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."memory_telemetry_event" AS ENUM('search', 'context', 'save', 'inject');--> statement-breakpoint
CREATE TYPE "public"."memory_visibility" AS ENUM('personal', 'project', 'org');--> statement-breakpoint
CREATE TABLE "agent_memory_telemetry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"agent_job_id" uuid,
	"event" "memory_telemetry_event" NOT NULL,
	"query" text,
	"result_count" integer,
	"duration_ms" integer,
	"tokens_injected" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory_telemetry_hits" (
	"telemetry_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric(6, 4),
	"injected" boolean DEFAULT false NOT NULL,
	CONSTRAINT "agent_memory_telemetry_hits_pk" PRIMARY KEY("telemetry_id","observation_id")
);
--> statement-breakpoint
DROP INDEX "agent_observations_org_project_hash_idx";--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "visibility" "memory_visibility" DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "created_by_kind" "memory_created_by_kind" DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "work_item_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "feedback_item_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "supersedes_observation_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "confidence" numeric(3, 2) DEFAULT '0.50' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "verified_by_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_memory_telemetry" ADD CONSTRAINT "agent_memory_telemetry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_telemetry" ADD CONSTRAINT "agent_memory_telemetry_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_telemetry_hits" ADD CONSTRAINT "agent_memory_telemetry_hits_telemetry_id_agent_memory_telemetry_id_fk" FOREIGN KEY ("telemetry_id") REFERENCES "public"."agent_memory_telemetry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_telemetry_hits" ADD CONSTRAINT "agent_memory_telemetry_hits_observation_id_agent_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."agent_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memory_telemetry_org_idx" ON "agent_memory_telemetry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_memory_telemetry_job_idx" ON "agent_memory_telemetry" USING btree ("agent_job_id");--> statement-breakpoint
CREATE INDEX "agent_memory_telemetry_event_idx" ON "agent_memory_telemetry" USING btree ("event");--> statement-breakpoint
CREATE INDEX "agent_memory_telemetry_created_at_idx" ON "agent_memory_telemetry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_memory_telemetry_hits_observation_idx" ON "agent_memory_telemetry_hits" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "agent_memory_telemetry_hits_injected_idx" ON "agent_memory_telemetry_hits" USING btree ("injected");--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_feedback_item_id_feedback_items_id_fk" FOREIGN KEY ("feedback_item_id") REFERENCES "public"."feedback_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_supersedes_observation_id_agent_observations_id_fk" FOREIGN KEY ("supersedes_observation_id") REFERENCES "public"."agent_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_verified_by_user_id_user_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_observations_agent_job_idx" ON "agent_observations" USING btree ("agent_job_id");--> statement-breakpoint
CREATE INDEX "agent_observations_owner_user_idx" ON "agent_observations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "agent_observations_work_item_idx" ON "agent_observations" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "agent_observations_feedback_item_idx" ON "agent_observations" USING btree ("feedback_item_id");--> statement-breakpoint
CREATE INDEX "agent_observations_visibility_idx" ON "agent_observations" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "agent_observations_supersedes_idx" ON "agent_observations" USING btree ("supersedes_observation_id");--> statement-breakpoint
CREATE INDEX "agent_observations_verified_by_user_idx" ON "agent_observations" USING btree ("verified_by_user_id");--> statement-breakpoint
CREATE INDEX "agent_observations_archived_at_idx" ON "agent_observations" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "agent_observations_expires_at_idx" ON "agent_observations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_observations_project_visibility_hash_unique_idx" ON "agent_observations" USING btree ("organization_id","project_id","content_hash") WHERE "agent_observations"."visibility" = 'project' AND "agent_observations"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_observations_org_visibility_hash_unique_idx" ON "agent_observations" USING btree ("organization_id","content_hash") WHERE "agent_observations"."visibility" = 'org' AND "agent_observations"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_observations_personal_visibility_hash_unique_idx" ON "agent_observations" USING btree ("organization_id","owner_user_id","content_hash") WHERE "agent_observations"."visibility" = 'personal' AND "agent_observations"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_visibility_scope_check" CHECK ((
        ("agent_observations"."visibility" = 'personal' AND "agent_observations"."owner_user_id" IS NOT NULL AND "agent_observations"."project_id" IS NULL)
        OR
        ("agent_observations"."visibility" = 'project' AND "agent_observations"."project_id" IS NOT NULL AND "agent_observations"."owner_user_id" IS NULL)
        OR
        ("agent_observations"."visibility" = 'org' AND "agent_observations"."project_id" IS NULL AND "agent_observations"."owner_user_id" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_confidence_range_check" CHECK ("agent_observations"."confidence" >= 0 AND "agent_observations"."confidence" <= 1);--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_verification_consistency_check" CHECK ((
        ("agent_observations"."verified_by_user_id" IS NULL AND "agent_observations"."verified_at" IS NULL)
        OR
        ("agent_observations"."verified_by_user_id" IS NOT NULL AND "agent_observations"."verified_at" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_not_self_superseded_check" CHECK ("agent_observations"."supersedes_observation_id" IS NULL OR "agent_observations"."supersedes_observation_id" <> "agent_observations"."id");