ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "nightly_validation" jsonb DEFAULT '{"enabled":false,"startHour":1,"endHour":6,"timezone":"Europe/Madrid"}'::jsonb;--> statement-breakpoint
UPDATE "projects" AS p
SET "nightly_validation" = os."nightly_validation"
FROM "organization_settings" AS os
WHERE p."organization_id" = os."organization_id"
  AND os."nightly_validation" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "nightly_validation";
