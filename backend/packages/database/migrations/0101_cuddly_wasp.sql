ALTER TYPE "public"."agent_job_type" ADD VALUE 'nightly-fix';--> statement-breakpoint
ALTER TYPE "public"."column_role" ADD VALUE 'needs_fix' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."column_role" ADD VALUE 'validating' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."quota_alert_type" ADD VALUE 'warning_75' BEFORE 'warning_80';