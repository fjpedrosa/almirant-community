/**
 * Migration script: Migrate legacy `assignee` text field to `work_item_assignees` junction table.
 *
 * For each work item with a non-null `assignee` string, tries to find a matching user
 * by name (case-insensitive) and creates an entry in `work_item_assignees` with role "responsible".
 *
 * Idempotent: uses ON CONFLICT DO NOTHING to avoid duplicates.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run src/scripts/migrate-assignees.ts
 */

import { db } from "../client";
import { workItems, workItemAssignees } from "../schema";
import { user } from "../schema/auth";
import { isNotNull, ilike, sql } from "drizzle-orm";

const main = async () => {
  console.log("Starting assignee migration...\n");

  // 1. Fetch all work items with a non-null assignee text field
  const itemsWithAssignee = await db
    .select({
      id: workItems.id,
      assignee: workItems.assignee,
    })
    .from(workItems)
    .where(isNotNull(workItems.assignee));

  console.log(`Found ${itemsWithAssignee.length} work items with legacy assignee text.\n`);

  if (itemsWithAssignee.length === 0) {
    console.log("Nothing to migrate.");
    process.exit(0);
  }

  // 2. Fetch all users for matching
  const allUsers = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    .from(user);

  console.log(`Found ${allUsers.length} users in the system.\n`);

  // Build a map of lowercase name -> user for fast matching
  const userByLowerName = new Map<string, { id: string; name: string; email: string }>();
  for (const u of allUsers) {
    userByLowerName.set(u.name.toLowerCase(), u);
  }

  let matched = 0;
  let unmatched = 0;
  let skippedAlreadyExists = 0;
  const unmatchedValues: { workItemId: string; assignee: string }[] = [];

  for (const item of itemsWithAssignee) {
    const assigneeText = item.assignee?.trim();
    if (!assigneeText) continue;

    // Try exact case-insensitive match
    const matchedUser = userByLowerName.get(assigneeText.toLowerCase());

    if (!matchedUser) {
      unmatched++;
      unmatchedValues.push({ workItemId: item.id, assignee: assigneeText });
      continue;
    }

    // Insert into work_item_assignees (idempotent)
    const [result] = await db
      .insert(workItemAssignees)
      .values({
        workItemId: item.id,
        userId: matchedUser.id,
        role: "responsible",
      })
      .onConflictDoNothing({
        target: [workItemAssignees.workItemId, workItemAssignees.userId],
      })
      .returning({ id: workItemAssignees.id });

    if (result) {
      matched++;
      console.log(`  [OK] "${assigneeText}" -> user ${matchedUser.name} (${matchedUser.id}) for work item ${item.id}`);
    } else {
      skippedAlreadyExists++;
      console.log(`  [SKIP] "${assigneeText}" already assigned to work item ${item.id}`);
    }
  }

  console.log("\n--- Migration Summary ---");
  console.log(`Total work items with assignee: ${itemsWithAssignee.length}`);
  console.log(`Successfully migrated: ${matched}`);
  console.log(`Already existed (skipped): ${skippedAlreadyExists}`);
  console.log(`Unmatched (no user found): ${unmatched}`);

  if (unmatchedValues.length > 0) {
    console.log("\nUnmatched assignee values:");
    for (const { workItemId, assignee } of unmatchedValues) {
      console.log(`  - "${assignee}" (work item: ${workItemId})`);
    }
  }

  console.log("\nMigration complete.");
  process.exit(0);
};

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
