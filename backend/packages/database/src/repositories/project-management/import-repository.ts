import { db } from "../../client";
import { importJobs } from "../../schema";
import { eq, and, desc } from "drizzle-orm";
import type { ImportJob, NewImportJob } from "../../schema";

// Get all import jobs
export const getImportJobs = async (workspaceId: string, limit = 20): Promise<ImportJob[]> => {
  return db
    .select()
    .from(importJobs)
    .where(eq(importJobs.workspaceId, workspaceId))
    .orderBy(desc(importJobs.createdAt))
    .limit(limit);
};

// Get import job by ID
export const getImportJobById = async (workspaceId: string, id: string): Promise<ImportJob | null> => {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, id), eq(importJobs.workspaceId, workspaceId)))
    .limit(1);

  return job || null;
};

// Create import job
export const createImportJob = async (
  workspaceId: string,
  data: Omit<NewImportJob, "id" | "createdAt" | "workspaceId">
): Promise<ImportJob> => {
  const [job] = await db
    .insert(importJobs)
    .values({
      ...data,
      workspaceId,
    })
    .returning();

  if (!job) throw new Error("Failed to create import job");
  return job;
};

// Update import job
export const updateImportJob = async (
  workspaceId: string,
  id: string,
  data: Partial<ImportJob>
): Promise<ImportJob | null> => {
  const [updated] = await db
    .update(importJobs)
    .set(data)
    .where(and(eq(importJobs.id, id), eq(importJobs.workspaceId, workspaceId)))
    .returning();

  return updated || null;
};
