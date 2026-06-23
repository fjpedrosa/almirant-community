-- Seed the Auto-Fix Bot user (portable — no org IDs hardcoded).
-- Membership and API key are provisioned separately at runtime via
-- backend/scripts/provision-auto-fix-bot-key.ts (requires ORG_IDS env var).
--
-- The `user` table has a UNIQUE constraint on email (better-auth), so
-- ON CONFLICT (email) DO NOTHING is valid here.
INSERT INTO "user" (id, email, name, image, email_verified, role, locale, created_at, updated_at)
VALUES (
  'auto-fix-bot',
  'bot@almirant.internal',
  'Auto-Fix Bot',
  NULL,
  true,
  'user',
  'en',
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;
