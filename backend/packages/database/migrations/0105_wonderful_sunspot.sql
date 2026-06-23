ALTER TYPE "public"."column_role" ADD VALUE IF NOT EXISTS 'to_document' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."event_triggered_by" ADD VALUE IF NOT EXISTS 'worker';--> statement-breakpoint
ALTER TYPE "public"."event_triggered_by" ADD VALUE IF NOT EXISTS 'websocket';--> statement-breakpoint
ALTER TYPE "public"."event_triggered_by" ADD VALUE IF NOT EXISTS 'api';--> statement-breakpoint
ALTER TYPE "public"."event_triggered_by" ADD VALUE IF NOT EXISTS 'nightly';--> statement-breakpoint
ALTER TYPE "public"."event_triggered_by" ADD VALUE IF NOT EXISTS 'mcp';
