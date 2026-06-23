import { db } from "../../client";
import { importJobs } from "../../schema";
import { eq, and, desc } from "drizzle-orm";
import type { ImportJob, NewImportJob } from "../../schema";

// Get all import jobs
export const getImportJobs = async (organizationId: string, limit = 20): Promise<ImportJob[]> => {
  return db
    .select()
    .from(importJobs)
    .where(eq(importJobs.organizationId, organizationId))
    .orderBy(desc(importJobs.createdAt))
    .limit(limit);
};

// Get import job by ID
export const getImportJobById = async (organizationId: string, id: string): Promise<ImportJob | null> => {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, id), eq(importJobs.organizationId, organizationId)))
    .limit(1);

  return job || null;
};

// Create import job
export const createImportJob = async (
  organizationId: string,
  data: Omit<NewImportJob, "id" | "createdAt" | "organizationId">
): Promise<ImportJob> => {
  const [job] = await db
    .insert(importJobs)
    .values({
      ...data,
      organizationId,
    })
    .returning();

  if (!job) throw new Error("Failed to create import job");
  return job;
};

// Update import job
export const updateImportJob = async (
  organizationId: string,
  id: string,
  data: Partial<ImportJob>
): Promise<ImportJob | null> => {
  const [updated] = await db
    .update(importJobs)
    .set(data)
    .where(and(eq(importJobs.id, id), eq(importJobs.organizationId, organizationId)))
    .returning();

  return updated || null;
};
