CREATE TYPE "public"."orchestration_strategy" AS ENUM('round_robin', 'sequential', 'reset_first');--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "orchestration_strategy" "orchestration_strategy";
