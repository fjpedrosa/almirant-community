ALTER TYPE "public"."waitlist_action_type" ADD VALUE 'pioneer_payment';--> statement-breakpoint
ALTER TABLE "waitlist_users" ALTER COLUMN "tier" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "waitlist_users" ALTER COLUMN "tier" SET DEFAULT 'none'::text;--> statement-breakpoint
DROP TYPE "public"."waitlist_tier";--> statement-breakpoint
CREATE TYPE "public"."waitlist_tier" AS ENUM('none', 'early_access', 'supporter', 'pioneer');--> statement-breakpoint
ALTER TABLE "waitlist_users" ALTER COLUMN "tier" SET DEFAULT 'none'::"public"."waitlist_tier";--> statement-breakpoint
ALTER TABLE "waitlist_users"
ALTER COLUMN "tier"
SET DATA TYPE "public"."waitlist_tier"
USING (
  CASE
    WHEN "tier" = 'one_month_pro' THEN 'supporter'
    WHEN "tier" IN ('none', 'early_access', 'supporter', 'pioneer') THEN "tier"
    ELSE 'none'
  END
)::"public"."waitlist_tier";
