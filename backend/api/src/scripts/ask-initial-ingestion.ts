/**
 * One-shot script: Run initial Ask ingestion for all projects (or a specific one).
 *
 * Populates ask_documents with work items, documents, and events so the
 * Ask RAG pipeline has evidence to search against.
 *
 * Usage:
 *   cd backend/api
 *
 *   # All projects
 *   bun run --env-file .env src/scripts/ask-initial-ingestion.ts
 *
 *   # Single project
 *   bun run --env-file .env src/scripts/ask-initial-ingestion.ts <projectId>
 */

import { db, projects, eq, closeConnections } from "@almirant/database";
import { runIncrementalIngestion } from "../domains/ai/ask/services/ingestion-service";

const targetProjectId = process.argv[2];

const main = async () => {
  console.log("=== Ask Initial Ingestion ===\n");

  let projectRows: { id: string; name: string; organizationId: string | null }[];

  if (targetProjectId) {
    projectRows = await db
      .select({ id: projects.id, name: projects.name, organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, targetProjectId));

    if (projectRows.length === 0) {
      console.error(`Project ${targetProjectId} not found`);
      process.exit(1);
    }
  } else {
    projectRows = await db
      .select({ id: projects.id, name: projects.name, organizationId: projects.organizationId })
      .from(projects);
  }

  const projectList = projectRows.filter(
    (
      project,
    ): project is { id: string; name: string; organizationId: string } =>
      typeof project.organizationId === "string" && project.organizationId.length > 0,
  );

  console.log(`Found ${projectList.length} project(s) to ingest\n`);

  let grandTotal = 0;

  for (const project of projectList) {
    console.log(`--- ${project.name} (${project.id}) ---`);

    const results = await runIncrementalIngestion(project.organizationId, project.id);

    let projectTotal = 0;
    for (const r of results) {
      const icon = r.status === "completed" ? "✓" : "✗";
      console.log(`  ${icon} ${r.sourceType}: ${r.itemsProcessed}${r.errorMessage ? ` (${r.errorMessage})` : ""}`);
      projectTotal += r.itemsProcessed;
    }
    console.log(`  total: ${projectTotal}\n`);
    grandTotal += projectTotal;
  }

  console.log(`=== Done — ${grandTotal} documents ingested ===`);
};

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => closeConnections());
