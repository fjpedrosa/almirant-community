ALTER TABLE "scheduled_agent_configs" DROP CONSTRAINT "scheduled_agent_configs_skill_id_skills_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" DROP COLUMN "skill_id";--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" DROP COLUMN "skill_name";