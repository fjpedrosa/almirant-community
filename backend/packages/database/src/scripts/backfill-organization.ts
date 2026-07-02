/**
 * Backfill script: Create a default workspace and assign all existing data to it.
 *
 * This script:
 * 1. Creates a "Default" workspace (or finds existing one by slug "default")
 * 2. Creates a "member" record (role=owner) for each existing user
 * 3. Updates all session records to set active_workspace_id
 * 4. Backfills workspace_id on all tenant-scoped tables where it's NULL
 *
 * Idempotent: safe to run multiple times. Uses ON CONFLICT DO NOTHING for inserts,
 * and only updates rows WHERE workspace_id IS NULL.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run --env-file .env.local src/scripts/backfill-organization.ts
 */

import { db, closeConnections } from "../client";
import { workspace, member } from "../schema/workspace";
import { user, session } from "../schema/auth";
import { eq, isNull, sql } from "drizzle-orm";

const DEFAULT_ORG_SLUG = "default";
const DEFAULT_ORG_NAME = "Default";

const main = async () => {
  console.log("=== Backfill Workspace Script ===\n");

  // ---------------------------------------------------------------
  // Step 1: Create or find the default workspace
  // ---------------------------------------------------------------
  console.log("Step 1: Ensuring default workspace exists...");

  const existingOrg = await db
    .select()
    .from(workspace)
    .where(eq(workspace.slug, DEFAULT_ORG_SLUG))
    .limit(1);

  let defaultOrgId: string;

  if (existingOrg.length > 0) {
    defaultOrgId = existingOrg[0].id;
    console.log(`  [SKIP] Default workspace already exists: ${defaultOrgId}`);
  } else {
    // Generate a random ID in the same format Better-Auth uses (nanoid-like)
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);

    const [newOrg] = await db
      .insert(workspace)
      .values({
        id,
        name: DEFAULT_ORG_NAME,
        slug: DEFAULT_ORG_SLUG,
      })
      .returning();

    defaultOrgId = newOrg.id;
    console.log(`  [OK] Created default workspace: ${defaultOrgId}`);
  }

  // ---------------------------------------------------------------
  // Step 2: Create member records for all existing users
  // ---------------------------------------------------------------
  console.log("\nStep 2: Creating member records for existing users...");

  const allUsers = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user);

  console.log(`  Found ${allUsers.length} users.`);

  let membersCreated = 0;
  let membersSkipped = 0;

  for (const u of allUsers) {
    const memberId = crypto.randomUUID().replace(/-/g, "").slice(0, 24);

    try {
      const result = await db
        .insert(member)
        .values({
          id: memberId,
          workspaceId: defaultOrgId,
          userId: u.id,
          role: "owner",
        })
        .onConflictDoNothing()
        .returning({ id: member.id });

      if (result.length > 0) {
        membersCreated++;
        console.log(`  [OK] ${u.name} (${u.email}) -> owner`);
      } else {
        membersSkipped++;
        console.log(`  [SKIP] ${u.name} (${u.email}) already a member`);
      }
    } catch (error) {
      // If there's no unique constraint on (workspaceId, userId), we check manually
      const existing = await db
        .select({ id: member.id })
        .from(member)
        .where(
          sql`${member.workspaceId} = ${defaultOrgId} AND ${member.userId} = ${u.id}`
        )
        .limit(1);

      if (existing.length > 0) {
        membersSkipped++;
        console.log(`  [SKIP] ${u.name} (${u.email}) already a member`);
      } else {
        throw error;
      }
    }
  }

  console.log(`  Members created: ${membersCreated}, skipped: ${membersSkipped}`);

  // ---------------------------------------------------------------
  // Step 3: Update sessions to set active_workspace_id
  // ---------------------------------------------------------------
  console.log("\nStep 3: Updating sessions with active_workspace_id...");

  const sessionResult = await db
    .update(session)
    .set({ activeWorkspaceId: defaultOrgId })
    .where(isNull(session.activeWorkspaceId))
    .returning({ id: session.id });

  console.log(`  [OK] Updated ${sessionResult.length} sessions.`);

  // ---------------------------------------------------------------
  // Step 4: Backfill workspace_id on all tenant-scoped tables
  // ---------------------------------------------------------------
  console.log("\nStep 4: Backfilling workspace_id on tenant-scoped tables...");

  const tableNames = [
    "tags",
    "funnels",
    "leads",
    "companies",
    "webhooks",
    "import_jobs",
    "api_keys",
    "document_categories",
    "task_id_counters",
    "github_installations",
    "provider_quotas",
  ];

  for (const tableName of tableNames) {
    const result = await db.execute(
      sql`UPDATE ${sql.identifier(tableName)} SET workspace_id = ${defaultOrgId} WHERE workspace_id IS NULL`
    );

    const count = Number(result.count ?? result.length ?? 0);
    if (count > 0) {
      console.log(`  [OK] ${tableName}: updated ${count} rows`);
    } else {
      console.log(`  [SKIP] ${tableName}: no rows to update`);
    }
  }

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log("\n=== Backfill Complete ===");
  console.log(`Default workspace ID: ${defaultOrgId}`);
  console.log(`Default workspace slug: ${DEFAULT_ORG_SLUG}`);

  await closeConnections();
  process.exit(0);
};

main().catch(async (err) => {
  console.error("\nBackfill failed:", err);
  await closeConnections();
  process.exit(1);
});
