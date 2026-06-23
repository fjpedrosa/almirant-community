import { db } from "../../client";
import { sprintDocuments, documents } from "../../schema";
import { and, eq } from "drizzle-orm";

export const SPRINT_DOCUMENT_KIND_VISUAL_REPORT = "visual-report" as const;
export const SPRINT_DOCUMENT_KIND_CHANGELOG = "changelog" as const;

export type SprintDocumentRef = { id: string; title: string };

export const getSprintDocumentRefByKind = async (
  sprintId: string,
  kind: string
): Promise<SprintDocumentRef | null> => {
  const [row] = await db
    .select({
      id: documents.id,
      title: documents.title,
    })
    .from(sprintDocuments)
    .innerJoin(documents, eq(sprintDocuments.documentId, documents.id))
    .where(and(eq(sprintDocuments.sprintId, sprintId), eq(sprintDocuments.kind, kind)))
    .limit(1);

  return row ?? null;
};

export const setSprintDocumentForKind = async (args: {
  sprintId: string;
  documentId: string;
  kind: string;
}) => {
  const [row] = await db
    .insert(sprintDocuments)
    .values({
      sprintId: args.sprintId,
      documentId: args.documentId,
      kind: args.kind,
    })
    .onConflictDoUpdate({
      target: [sprintDocuments.sprintId, sprintDocuments.kind],
      set: {
        documentId: args.documentId,
      },
    })
    .returning();

  return row;
};

