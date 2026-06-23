ALTER TYPE "public"."agent_provider" ADD VALUE 'zipu';--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;