ALTER TABLE "agent_jobs" ADD COLUMN "runtime_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "agent_native_events" ADD COLUMN "ai_provider" "ai_provider";--> statement-breakpoint
ALTER TABLE "agent_native_events" ADD COLUMN "model" varchar(256);--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "runtime_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "usage_records" ADD COLUMN "provider_cost_usd" numeric(20, 9);--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_idempotency_key_unique_idx" ON "usage_records" USING btree ("idempotency_key");