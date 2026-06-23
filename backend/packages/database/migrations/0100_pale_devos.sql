CREATE TYPE "public"."usage_session_type" AS ENUM('implement', 'validate', 'planning', 'review', 'chat');--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"session_type" "usage_session_type" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"tokens_used" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"period" varchar(7) NOT NULL,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"implement_seconds" integer DEFAULT 0 NOT NULL,
	"validate_seconds" integer DEFAULT 0 NOT NULL,
	"planning_seconds" integer DEFAULT 0 NOT NULL,
	"review_seconds" integer DEFAULT 0 NOT NULL,
	"chat_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_summaries" ADD CONSTRAINT "usage_summaries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_records_org_idx" ON "usage_records" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "usage_records_project_idx" ON "usage_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "usage_records_session_type_idx" ON "usage_records" USING btree ("session_type");--> statement-breakpoint
CREATE INDEX "usage_records_started_at_idx" ON "usage_records" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_summaries_org_period_idx" ON "usage_summaries" USING btree ("organization_id","period");--> statement-breakpoint
CREATE INDEX "usage_summaries_org_idx" ON "usage_summaries" USING btree ("organization_id");