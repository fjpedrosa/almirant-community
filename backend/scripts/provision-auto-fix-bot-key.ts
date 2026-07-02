/**
 * Runtime provisioning script for the Auto-Fix Bot.
 *
 * Prerequisites:
 *   1. Migration 0167_auto_fix_bot_user.sql has been applied (creates the bot user).
 *   2. ORG_IDS env var contains the comma-separated UUIDs of the orgs where the bot
 *      must operate. IDs vary per environment — get them with:
 *        SELECT id, slug, name FROM workspace;
 *
 * What this script does:
 *   (a) Creates bot membership in each org — idempotent (SELECT + conditional INSERT,
 *       no ON CONFLICT because member table has no unique constraint on (userId, orgId)).
 *   (b) Creates one API key for the bot (prefix alm_k1_) against the primary org,
 *       prints the plaintext to stdout ONCE. The operator must copy it to .env manually.
 *
 * Usage:
 *   ORG_IDS=<uuid1>,<uuid2> bun run --env-file backend/api/.env backend/scripts/provision-auto-fix-bot-key.ts
 *
 * Re-execution:
 *   Memberships are idempotent. The API key is RECREATED each run — revoke the old
 *   key manually from the backoffice UI before re-running if you lost the plaintext.
 */

import { db, member, createApiKey, and, eq } from "@almirant/database";

const BOT_USER_ID = "auto-fix-bot";
const BOT_KEY_NAME = "worker-auto-fix";

const orgIds = (process.env.ORG_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (orgIds.length === 0) {
  console.error("❌ ORG_IDS env var is required (comma-separated org UUIDs).");
  console.error(
    "   Example: ORG_IDS=abc123,def456 bun run backend/scripts/provision-auto-fix-bot-key.ts"
  );
  process.exit(1);
}

console.log(`\nAuto-Fix Bot provisioning`);
console.log(`Bot user: ${BOT_USER_ID}`);
console.log(`Target orgs: ${orgIds.join(", ")}\n`);

// ─── (a) Memberships ────────────────────────────────────────────────────────
// The `member` table has no unique constraint on (userId, workspaceId) —
// confirmed in backfill-organization.ts:98-113. We check manually per row.

for (const orgId of orgIds) {
  const [existing] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, BOT_USER_ID), eq(member.workspaceId, orgId)))
    .limit(1);

  if (existing) {
    console.log(`[SKIP] membership already exists in org ${orgId}`);
  } else {
    const memberId = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    await db.insert(member).values({
      id: memberId,
      workspaceId: orgId,
      userId: BOT_USER_ID,
      role: "member",
      createdAt: new Date(),
    });
    console.log(`[OK]   membership created in org ${orgId}`);
  }
}

// ─── (b) API key ─────────────────────────────────────────────────────────────
// One key is enough — the bot uses projectId in the MCP URL, and
// resolveProjectWorkspace() resolves the org from the projectId because
// the bot is now a member of all target orgs (see step a above).

const primaryOrgId = orgIds[0]!;
const { key, keyPrefix } = await createApiKey(primaryOrgId, BOT_KEY_NAME, {
  userId: BOT_USER_ID,
});

console.log(`\n✅ Auto-Fix Bot API key provisioned.`);
console.log(
  `   keyPrefix: ${keyPrefix}  (use this in backoffice to identify / revoke the key)`
);
console.log(
  `\n   ⚠️  Add the following to the worker's .env — this is the ONLY time it's shown:\n`
);
console.log(`   MC_API_KEY=${key}\n`);
console.log(
  `   If you lose this value, revoke the key (prefix: ${keyPrefix}) from the backoffice\n` +
    `   and re-run this script to generate a new one.\n`
);

process.exit(0);
