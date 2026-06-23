/**
 * Backfill script: migrate legacy `work_items.type = 'idea'` into `idea_items`.
 *
 * Strategy:
 * 1. Read all legacy idea work items.
 * 2. Resolve organization scope from project, creator membership, or first org fallback.
 * 3. Create one `idea_items` row per legacy work item (idempotent by metadata.legacyWorkItemId).
 * 4. Create traceability link in `idea_item_work_item_links` (linkType=related_to).
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run --env-file .env.local src/scripts/backfill-idea-items.ts
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db, closeConnections } from "../client";
import {
  ideaItems,
  ideaItemWorkItemLinks,
  member,
  organization,
  projects,
  workItemAssignees,
  workItems,
} from "../schema";

type LegacyIdeaRow = {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  taskId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

const resolveOrganizationId = async (row: LegacyIdeaRow): Promise<string | null> => {
  if (row.projectId) {
    const [project] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    if (project?.organizationId) return project.organizationId;
  }

  if (row.createdByUserId) {
    const [creatorMembership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, row.createdByUserId))
      .orderBy(asc(member.createdAt))
      .limit(1);
    if (creatorMembership?.organizationId) return creatorMembership.organizationId;
  }

  const [firstOrg] = await db
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.createdAt))
    .limit(1);

  return firstOrg?.id ?? null;
};

const resolveOwnerUserId = async (workItemId: string): Promise<string | null> => {
  const [assignee] = await db
    .select({ userId: workItemAssignees.userId })
    .from(workItemAssignees)
    .where(eq(workItemAssignees.workItemId, workItemId))
    .orderBy(asc(workItemAssignees.assignedAt))
    .limit(1);

  return assignee?.userId ?? null;
};

const findExistingMigratedIdeaItemId = async (legacyWorkItemId: string): Promise<string | null> => {
  const [existing] = await db
    .select({ id: ideaItems.id })
    .from(ideaItems)
    .where(sql`${ideaItems.metadata}->>'legacyWorkItemId' = ${legacyWorkItemId}`)
    .limit(1);

  return existing?.id ?? null;
};

const main = async () => {
  console.log("=== Backfill Legacy Ideas -> idea_items ===\n");

  const legacyIdeas = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      title: workItems.title,
      description: workItems.description,
      metadata: workItems.metadata,
      taskId: workItems.taskId,
      createdByUserId: workItems.createdByUserId,
      createdAt: workItems.createdAt,
      updatedAt: workItems.updatedAt,
      archivedAt: workItems.archivedAt,
    })
    .from(workItems)
    .where(eq(workItems.type, "idea"));

  console.log(`Found ${legacyIdeas.length} legacy idea work items`);

  let created = 0;
  let skipped = 0;
  let linked = 0;
  let failed = 0;

  for (const legacy of legacyIdeas) {
    try {
      const existingIdeaItemId = await findExistingMigratedIdeaItemId(legacy.id);
      const ownerUserId = await resolveOwnerUserId(legacy.id);

      let ideaItemId = existingIdeaItemId;
      if (!ideaItemId) {
        const organizationId = await resolveOrganizationId(legacy);
        if (!organizationId) {
          console.warn(`  [SKIP] ${legacy.id}: cannot resolve organizationId`);
          skipped++;
          continue;
        }

        const [inserted] = await db
          .insert(ideaItems)
          .values({
            organizationId,
            projectId: legacy.projectId,
            type: "idea",
            status: legacy.archivedAt ? "archived" : "active",
            title: legacy.title,
            description: legacy.description,
            ownerUserId,
            dueDate: null,
            metadata: {
              ...(legacy.metadata ?? {}),
              legacyWorkItemId: legacy.id,
              legacyTaskId: legacy.taskId,
              migratedFrom: "work_items.idea",
            },
            createdAt: legacy.createdAt,
            updatedAt: legacy.updatedAt,
          })
          .returning({ id: ideaItems.id });

        if (!inserted) {
          console.warn(`  [SKIP] ${legacy.id}: failed creating idea item`);
          skipped++;
          continue;
        }

        ideaItemId = inserted.id;
        created++;
      } else {
        skipped++;
      }

      await db
        .insert(ideaItemWorkItemLinks)
        .values({
          ideaItemId,
          workItemId: legacy.id,
          linkType: "related_to",
          createdBy: legacy.createdByUserId,
          metadata: {
            migratedFrom: "legacy-work-item",
          },
        })
        .onConflictDoNothing({
          target: [ideaItemWorkItemLinks.ideaItemId, ideaItemWorkItemLinks.workItemId],
        });

      linked++;
    } catch (error) {
      failed++;
      console.error(`  [FAIL] ${legacy.id}:`, error instanceof Error ? error.message : String(error));
    }
  }

  console.log("\n=== Backfill Summary ===");
  console.log(`Created idea_items: ${created}`);
  console.log(`Skipped existing: ${skipped}`);
  console.log(`Work-item links ensured: ${linked}`);
  console.log(`Failed: ${failed}`);

  await closeConnections();
  process.exit(failed > 0 ? 1 : 0);
};

main().catch(async (error) => {
  console.error("Backfill execution failed:", error);
  await closeConnections();
  process.exit(1);
});
