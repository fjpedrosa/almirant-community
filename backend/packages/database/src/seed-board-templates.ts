import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

type NewTemplate = typeof schema.boardTemplates.$inferInsert;
const boardTemplateData: NewTemplate[] = [
  {
    name: "Development",
    description:
      "Software development board with full flow from backlog to production",
    area: "desarrollo" as const,
    columns: [
      { name: "Backlog", color: "#94a3b8", order: 0, isDone: false, role: "backlog" },
      { name: "In Progress", color: "#f59e0b", order: 1, isDone: false, role: "in_progress" },
      { name: "To Review", color: "#8b5cf6", order: 2, isDone: false, role: "review" },
      { name: "Validating", color: "#ec4899", order: 3, isDone: false, role: "validating" },
      { name: "To Release", color: "#a855f7", order: 4, isDone: false, role: "release" },
      { name: "Done", color: "#22c55e", order: 5, isDone: true, role: "done" },
    ],
    isBuiltIn: true,
  },
  {
    name: "Sales",
    description:
      "Sales pipeline with stages from prospecting to close",
    area: "ventas" as const,
    columns: [
      { name: "Prospect", color: "#94a3b8", order: 0, isDone: false, role: "other" },
      { name: "Contacted", color: "#6366f1", order: 1, isDone: false, role: "other" },
      { name: "Qualified", color: "#06b6d4", order: 2, isDone: false, role: "other" },
      { name: "Proposal", color: "#f59e0b", order: 3, isDone: false, role: "other" },
      { name: "Negotiation", color: "#f97316", order: 4, isDone: false, role: "other" },
      { name: "Won", color: "#22c55e", order: 5, isDone: true, role: "done" },
      { name: "Lost", color: "#ef4444", order: 6, isDone: true, role: "done" },
    ],
    isBuiltIn: true,
  },
  {
    name: "Prospecting",
    description:
      "Board for managing prospecting activities and lead qualification",
    area: "prospeccion" as const,
    columns: [
      { name: "Research", color: "#94a3b8", order: 0, isDone: false, role: "other" },
      { name: "Outreach", color: "#6366f1", order: 1, isDone: false, role: "other" },
      { name: "Follow-up", color: "#f59e0b", order: 2, isDone: false, role: "other" },
      { name: "Qualified", color: "#22c55e", order: 3, isDone: true, role: "done" },
      { name: "Discarded", color: "#ef4444", order: 4, isDone: true, role: "done" },
    ],
    isBuiltIn: true,
  },
  {
    name: "Marketing",
    description:
      "Campaign and content management from ideation to publication",
    area: "marketing" as const,
    columns: [
      { name: "Ideas", color: "#94a3b8", order: 0, isDone: false, role: "other" },
      { name: "Planning", color: "#6366f1", order: 1, isDone: false, role: "other" },
      { name: "In Progress", color: "#f59e0b", order: 2, isDone: false, role: "in_progress" },
      { name: "Review", color: "#8b5cf6", order: 3, isDone: false, role: "review" },
      { name: "Published", color: "#22c55e", order: 4, isDone: true, role: "done" },
    ],
    isBuiltIn: true,
  },
  {
    name: "Simple Kanban",
    description:
      "Basic Kanban board with three columns for any type of project",
    area: "general" as const,
    columns: [
      { name: "To Do", color: "#6366f1", order: 0, isDone: false, role: "todo" },
      { name: "Doing", color: "#f59e0b", order: 1, isDone: false, role: "in_progress" },
      { name: "Done", color: "#22c55e", order: 2, isDone: true, role: "done" },
    ],
    isBuiltIn: true,
  },
];

async function seedBoardTemplates() {
  console.log("Seeding board templates (idempotent)...");

  let createdCount = 0;
  let skippedCount = 0;

  for (const template of boardTemplateData) {
    const existing = await db
      .select({ id: schema.boardTemplates.id })
      .from(schema.boardTemplates)
      .where(eq(schema.boardTemplates.name, template.name))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  SKIP: "${template.name}" already exists (id: ${existing[0].id})`);
      skippedCount++;
      continue;
    }

    const [created] = await db
      .insert(schema.boardTemplates)
      .values(template)
      .returning({ id: schema.boardTemplates.id, name: schema.boardTemplates.name });

    console.log(`  CREATED: "${created.name}" (id: ${created.id})`);
    createdCount++;
  }

  console.log(`\nDone. Created: ${createdCount}, Skipped (already existed): ${skippedCount}`);

  await client.end();
  process.exit(0);
}

seedBoardTemplates().catch((error) => {
  console.error("Seed board templates failed:", error);
  process.exit(1);
});
