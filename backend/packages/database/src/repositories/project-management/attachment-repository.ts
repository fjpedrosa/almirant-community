import { db } from "../../client";
import { workItemAttachments, workItems, projects } from "../../schema";
import { eq, and, desc } from "drizzle-orm";
import type { WorkItemAttachment, CreateAttachmentRequest } from "../../domain/types";

export const getAttachmentsByWorkItem = async (
  workspaceId: string,
  workItemId: string
): Promise<WorkItemAttachment[]> => {
  // Verify work item belongs to org via project
  const [wi] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(eq(workItems.id, workItemId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!wi) return [];

  return db
    .select()
    .from(workItemAttachments)
    .where(eq(workItemAttachments.workItemId, workItemId))
    .orderBy(desc(workItemAttachments.createdAt)) as Promise<WorkItemAttachment[]>;
};

export const getAttachment = async (
  workspaceId: string,
  id: string
): Promise<WorkItemAttachment | null> => {
  const [result] = await db
    .select({
      id: workItemAttachments.id,
      workItemId: workItemAttachments.workItemId,
      fileName: workItemAttachments.fileName,
      fileUrl: workItemAttachments.fileUrl,
      fileSize: workItemAttachments.fileSize,
      mimeType: workItemAttachments.mimeType,
      uploadedBy: workItemAttachments.uploadedBy,
      metadata: workItemAttachments.metadata,
      createdAt: workItemAttachments.createdAt,
    })
    .from(workItemAttachments)
    .innerJoin(workItems, eq(workItemAttachments.workItemId, workItems.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(eq(workItemAttachments.id, id), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return (result as WorkItemAttachment) || null;
};

export const createAttachment = async (
  workspaceId: string,
  data: CreateAttachmentRequest
): Promise<WorkItemAttachment> => {
  // Verify work item belongs to org via project
  const [wi] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(eq(workItems.id, data.workItemId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!wi) throw new Error("Work item not found or does not belong to workspace");

  const [result] = await db
    .insert(workItemAttachments)
    .values(data)
    .returning();
  return result as WorkItemAttachment;
};

export const deleteAttachment = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  // Verify attachment belongs to org via work item -> project
  const attachment = await getAttachment(workspaceId, id);
  if (!attachment) return false;

  const result = await db
    .delete(workItemAttachments)
    .where(eq(workItemAttachments.id, id))
    .returning();
  return result.length > 0;
};
