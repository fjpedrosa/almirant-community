import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

async function seed() {
  console.log("🌱 Seeding database...");

  // Clear existing data
  console.log("Clearing existing data...");
  await db.delete(schema.documents);
  await db.delete(schema.documentCategories);
  await db.delete(schema.workItemTags);
  await db.delete(schema.workItems);
  await db.delete(schema.boardColumns);
  await db.delete(schema.boards);
  await db.delete(schema.boardTemplates);
  await db.delete(schema.projectNotes);
  await db.delete(schema.projectDocLinks);
  await db.delete(schema.projects);
  await db.delete(schema.webhookLogs);
  await db.delete(schema.webhooks);
  await db.delete(schema.tags);
  await db.delete(schema.importJobs);

  // Create tags
  console.log("Creating tags...");
  const tagColors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];
  const tagNames = ["Hot Lead", "Enterprise", "SMB", "Startup", "Real Estate", "Tech", "Consulting", "E-commerce"];

  const createdTags = await db
    .insert(schema.tags)
    .values(
      tagNames.map((name, i) => ({
        name,
        color: tagColors[i % tagColors.length],
      }))
    )
    .returning();

  // Create board templates
  console.log("Creating board templates...");
  const boardTemplateData = [
    {
      name: "Development",
      description: "Software development board with full flow from backlog to production",
      area: "desarrollo" as const,
      columns: [
        { name: "Backlog", color: "#94a3b8", order: 0, isDone: false, role: "backlog" },
        { name: "In Progress", color: "#f59e0b", order: 1, isDone: false, role: "in_progress" },
        { name: "Reviewing", color: "#8b5cf6", order: 2, isDone: false, role: "review" },
        { name: "Validating", color: "#ec4899", order: 3, isDone: false, role: "validating" },
        { name: "Release", color: "#a855f7", order: 4, isDone: false, role: "release" },
        { name: "Done", color: "#22c55e", order: 5, isDone: true, role: "done" },
      ],
      isBuiltIn: true,
    },
    {
      name: "Sales",
      description: "Sales pipeline with stages from prospecting to close",
      area: "ventas" as const,
      columns: [
        { name: "Prospect", color: "#94a3b8", order: 0, isDone: false },
        { name: "Contacted", color: "#6366f1", order: 1, isDone: false },
        { name: "Qualified", color: "#06b6d4", order: 2, isDone: false },
        { name: "Proposal", color: "#f59e0b", order: 3, isDone: false },
        { name: "Negotiation", color: "#f97316", order: 4, isDone: false },
        { name: "Won", color: "#22c55e", order: 5, isDone: true },
        { name: "Lost", color: "#ef4444", order: 6, isDone: true },
      ],
      isBuiltIn: true,
    },
    {
      name: "Prospecting",
      description: "Board for managing prospecting activities and lead qualification",
      area: "prospeccion" as const,
      columns: [
        { name: "Research", color: "#94a3b8", order: 0, isDone: false },
        { name: "Outreach", color: "#6366f1", order: 1, isDone: false },
        { name: "Follow-up", color: "#f59e0b", order: 2, isDone: false },
        { name: "Qualified", color: "#22c55e", order: 3, isDone: true },
        { name: "Discarded", color: "#ef4444", order: 4, isDone: true },
      ],
      isBuiltIn: true,
    },
    {
      name: "Marketing",
      description: "Campaign and content management from ideation to publication",
      area: "marketing" as const,
      columns: [
        { name: "Ideas", color: "#94a3b8", order: 0, isDone: false },
        { name: "Planning", color: "#6366f1", order: 1, isDone: false },
        { name: "In Progress", color: "#f59e0b", order: 2, isDone: false },
        { name: "Review", color: "#8b5cf6", order: 3, isDone: false },
        { name: "Published", color: "#22c55e", order: 4, isDone: true },
      ],
      isBuiltIn: true,
    },
    {
      name: "Simple Kanban",
      description: "Basic Kanban board with three columns for any type of project",
      area: "general" as const,
      columns: [
        { name: "To Do", color: "#6366f1", order: 0, isDone: false },
        { name: "Doing", color: "#f59e0b", order: 1, isDone: false },
        { name: "Done", color: "#22c55e", order: 2, isDone: true },
      ],
      isBuiltIn: true,
    },
  ];

  const createdBoardTemplates = await db
    .insert(schema.boardTemplates)
    .values(boardTemplateData)
    .returning();

  // Create document categories
  console.log("Creating document categories...");
  const docCategoryData = [
    { name: "Know-How", color: "#f59e0b", icon: "lightbulb", order: 0 },
    { name: "Journal", color: "#8b5cf6", icon: "book-open", order: 1 },
    { name: "Content", color: "#3b82f6", icon: "pen-tool", order: 2 },
    { name: "Notes", color: "#22c55e", icon: "sticky-note", order: 3 },
    { name: "Newsletters", color: "#f59e0b", icon: "mail", order: 4 },
    { name: "YouTube Scripts", color: "#ef4444", icon: "video", order: 5 },
    { name: "Other", color: "#6b7280", icon: "file-text", order: 6 },
  ];

  const createdDocCategories = await db
    .insert(schema.documentCategories)
    .values(docCategoryData)
    .returning();

  // Create default system settings (if not already present)
  console.log("Creating default system settings...");
  const existingSettings = await db.select().from(schema.systemSettings).limit(1);
  if (existingSettings.length === 0) {
    await db.insert(schema.systemSettings).values({});
  }

  console.log("✅ Seed completed!");
  console.log(`Created:
  - ${createdTags.length} tags
  - ${createdBoardTemplates.length} board templates
  - ${createdDocCategories.length} document categories
  - 1 system settings row (defaults)`);

  await client.end();
  process.exit(0);
}

seed().catch((error) => {
  console.error("❌ Seed failed:", error);
  process.exit(1);
});
