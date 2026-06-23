ALTER TYPE "public"."ai_provider" ADD VALUE 'openai-compatible';--> statement-breakpoint
ALTER TABLE "provider_api_keys" ADD COLUMN "base_url" varchar(512);