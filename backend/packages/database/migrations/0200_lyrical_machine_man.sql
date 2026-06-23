ALTER TYPE "public"."agent_provider" ADD VALUE 'grok';--> statement-breakpoint
ALTER TYPE "public"."ai_provider" ADD VALUE 'xai';--> statement-breakpoint
ALTER TYPE "public"."provider_type" ADD VALUE 'xai' BEFORE 'vercel';