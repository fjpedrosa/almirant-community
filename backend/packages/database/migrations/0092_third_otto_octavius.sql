ALTER TYPE "public"."health_service" ADD VALUE IF NOT EXISTS 'vps';--> statement-breakpoint
ALTER TABLE "webhook_logs" DROP CONSTRAINT "webhook_logs_lead_id_leads_id_fk";
--> statement-breakpoint
ALTER TABLE "webhooks" DROP CONSTRAINT "webhooks_funnel_id_funnels_id_fk";
--> statement-breakpoint
ALTER TABLE "webhooks" DROP CONSTRAINT "webhooks_stage_id_stages_id_fk";
--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "trigger" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."webhook_trigger";--> statement-breakpoint
CREATE TYPE "public"."webhook_trigger" AS ENUM('work_item_created', 'work_item_updated', 'work_item_moved', 'work_item_deleted', 'comment_added', 'attachment_added', 'sprint_closed', 'milestone_completed');--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "trigger" SET DATA TYPE "public"."webhook_trigger" USING "trigger"::"public"."webhook_trigger";--> statement-breakpoint
CREATE INDEX "agent_jobs_created_by_user_idx" ON "agent_jobs" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_organization_idx" ON "agent_jobs" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "webhook_logs" DROP COLUMN "lead_id";--> statement-breakpoint
ALTER TABLE "webhooks" DROP COLUMN "funnel_id";--> statement-breakpoint
ALTER TABLE "webhooks" DROP COLUMN "stage_id";