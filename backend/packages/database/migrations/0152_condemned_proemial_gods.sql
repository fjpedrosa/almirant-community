CREATE TYPE "public"."observation_type" AS ENUM('decision', 'architecture', 'bugfix', 'pattern', 'config', 'discovery', 'learning');--> statement-breakpoint
CREATE TABLE "agent_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"agent_job_id" uuid,
	"type" "observation_type" NOT NULL,
	"topic_key" varchar(500) NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text NOT NULL,
	"scope" varchar(500),
	"revision" integer DEFAULT 1 NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"search_vector" "tsvector",
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_observations" ADD CONSTRAINT "agent_observations_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_observations_organization_idx" ON "agent_observations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_observations_project_idx" ON "agent_observations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_observations_type_idx" ON "agent_observations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "agent_observations_topic_key_idx" ON "agent_observations" USING btree ("topic_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_observations_org_project_hash_idx" ON "agent_observations" USING btree ("organization_id","project_id","content_hash");--> statement-breakpoint
CREATE INDEX "agent_observations_search_vector_idx" ON "agent_observations" USING gin ("search_vector");