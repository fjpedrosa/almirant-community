import { db } from "../../client";
import { documentWorkItems } from "../../schema/document-work-items";
import { documents, documentCategories } from "../../schema/documents";
import { projects } from "../../schema/projects";
import { workItems } from "../../schema/work-items";
import { boardColumns } from "../../schema/boards";
import { eq, and } from "drizzle-orm";

export interface LinkedDocument {
  id: string;
  title: string;
  categoryName: string | null;
  categoryColor: string | null;
  projectName: string | null;
  projectColor: string | null;
  updatedAt: Date;
  linkedAt: Date;
}

export interface LinkedWorkItem {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  priority: string;
  columnName: string | null;
  columnColor: string | null;
  linkedAt: Date;
}

// Link a document to a work item
export const linkDocumentToWorkItem = async (
  documentId: string,
  workItemId: string
) => {
  const results = await db
    .insert(documentWorkItems)
    .values({ documentId, workItemId })
    .returning();

  return results[0];
};

// Unlink a document from a work item
export const unlinkDocumentFromWorkItem = async (
  documentId: string,
  workItemId: string
): Promise<boolean> => {
  const result = await db
    .delete(documentWorkItems)
    .where(
      and(
        eq(documentWorkItems.documentId, documentId),
        eq(documentWorkItems.workItemId, workItemId)
      )
    )
    .returning();

  return result.length > 0;
};

// Get linked documents for a work item
export const getDocumentsByWorkItemId = async (
  workItemId: string
): Promise<LinkedDocument[]> => {
  const results = await db
    .select({
      id: documents.id,
      title: documents.title,
      categoryName: documentCategories.name,
      categoryColor: documentCategories.color,
      projectName: projects.name,
      projectColor: projects.color,
      updatedAt: documents.updatedAt,
      linkedAt: documentWorkItems.createdAt,
    })
    .from(documentWorkItems)
    .innerJoin(documents, eq(documentWorkItems.documentId, documents.id))
    .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .where(eq(documentWorkItems.workItemId, workItemId));

  return results;
};

// Get linked work items for a document
export const getWorkItemsByDocumentId = async (
  documentId: string
): Promise<LinkedWorkItem[]> => {
  const results = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      columnName: boardColumns.name,
      columnColor: boardColumns.color,
      linkedAt: documentWorkItems.createdAt,
    })
    .from(documentWorkItems)
    .innerJoin(workItems, eq(documentWorkItems.workItemId, workItems.id))
    .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(eq(documentWorkItems.documentId, documentId));

  return results;
};
