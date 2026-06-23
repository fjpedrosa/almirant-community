ALTER TABLE "scheduled_agent_configs" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "coding_agent" varchar(100) DEFAULT 'claude-code';--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "ai_provider" varchar(100);--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "ai_model" varchar(100);--> statement-breakpoint
ALTER TABLE "scheduled_agent_configs" ADD COLUMN "reasoning_level" varchar(50);