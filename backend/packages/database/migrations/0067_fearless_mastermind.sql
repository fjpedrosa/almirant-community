ALTER TYPE "public"."connection_category" ADD VALUE IF NOT EXISTS 'monitoring';--> statement-breakpoint
ALTER TYPE "public"."provider_type" ADD VALUE IF NOT EXISTS 'sentry';--> statement-breakpoint
ALTER TYPE "public"."provider_type" ADD VALUE IF NOT EXISTS 'posthog';