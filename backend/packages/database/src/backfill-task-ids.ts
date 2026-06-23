import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, isNull, asc, sql } from "drizzle-orm";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

const generateProjectPrefix = (projectName: string | null): string => {
  if (!projectName) return "XX";
  const words = projectName.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "XX";
  return words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 10);
};

const getNextTaskId = async (prefix: string, organizationId: string): Promise<string> => {
  const [result] = await db
    .insert(schema.taskIdCounters)
    .values({ prefix, organizationId, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [schema.taskIdCounters.prefix, schema.taskIdCounters.organizationId],
      set: { nextNumber: sql`${schema.taskIdCounters.nextNumber} + 1` },
    })
    .returning({ currentNumber: sql<number>`${schema.taskIdCounters.nextNumber} - 1` });
  return `${prefix}-${result!.currentNumber}`;
};

async function backfill() {
  console.log("Backfilling task IDs for existing work items...");

  // Get all work items without taskId, ordered by creation date
  const items = await db
    .select({
      id: schema.workItems.id,
      projectId: schema.workItems.projectId,
      title: schema.workItems.title,
    })
    .from(schema.workItems)
    .where(isNull(schema.workItems.taskId))
    .orderBy(asc(schema.workItems.createdAt));

  console.log(`Found ${items.length} work items without taskId`);

  // Cache project context to avoid repeated lookups
  const projectContextCache = new Map<string, { name: string | null; organizationId: string | null }>();

  let count = 0;
  for (const item of items) {
    let projectName: string | null = null;
    let organizationId: string | null = null;

    if (item.projectId) {
      if (projectContextCache.has(item.projectId)) {
        const cached = projectContextCache.get(item.projectId)!;
        projectName = cached.name;
        organizationId = cached.organizationId;
      } else {
        const [proj] = await db
          .select({ name: schema.projects.name, organizationId: schema.projects.organizationId })
          .from(schema.projects)
          .where(eq(schema.projects.id, item.projectId))
          .limit(1);
        projectName = proj?.name ?? null;
        organizationId = proj?.organizationId ?? null;
        projectContextCache.set(item.projectId, { name: projectName, organizationId });
      }
    }

    if (!organizationId) {
      console.warn(`  Skipping ${item.id}: unable to resolve organization`);
      continue;
    }

    const prefix = generateProjectPrefix(projectName);
    const taskId = await getNextTaskId(prefix, organizationId);

    await db
      .update(schema.workItems)
      .set({ taskId })
      .where(eq(schema.workItems.id, item.id));

    count++;
    if (count % 50 === 0) {
      console.log(`  Processed ${count}/${items.length}...`);
    }
  }

  console.log(`Done! Assigned taskId to ${count} work items`);
  await client.end();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
