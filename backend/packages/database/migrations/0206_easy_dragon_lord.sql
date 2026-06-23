CREATE TYPE "public"."agent_trigger" AS ENUM('scheduled', 'webhook');--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "trigger" "agent_trigger" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "webhook_token" varchar(64);--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD CONSTRAINT "scheduled_agent_configs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_agent_configs_skill_id_idx" ON "scheduled_agent_configs" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "scheduled_agent_configs_trigger_idx" ON "scheduled_agent_configs" USING btree ("trigger");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_agent_configs_webhook_token_idx" ON "scheduled_agent_configs" USING btree ("webhook_token");