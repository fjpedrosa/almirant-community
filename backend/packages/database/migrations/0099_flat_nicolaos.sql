ALTER TABLE "projects" ALTER COLUMN "nightly_validation" SET DEFAULT '{"enabled":false,"startHour":1,"endHour":6,"timezone":"Europe/Madrid","provider":"claude-code"}'::jsonb;

UPDATE "projects"
SET "nightly_validation" = jsonb_set(
  COALESCE("nightly_validation", '{}'::jsonb),
  '{provider}',
  to_jsonb('claude-code'::text),
  true
)
WHERE "nightly_validation" IS NULL
   OR NOT ("nightly_validation" ? 'provider');
