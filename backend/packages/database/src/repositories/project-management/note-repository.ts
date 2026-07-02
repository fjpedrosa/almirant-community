import { db } from "../../client";
import { projectNotes, projects } from "../../schema";
import { eq, and } from "drizzle-orm";
import type {
  ProjectNote,
  CreateNoteRequest,
  UpdateNoteRequest,
} from "../../domain/types";

// Verify project belongs to workspace
const verifyProjectOrg = async (
  workspaceId: string,
  projectId: string
): Promise<boolean> => {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  return !!proj;
};

// Get all notes for a project
export const getNotes = async (
  workspaceId: string,
  projectId: string
): Promise<ProjectNote[]> => {
  if (!(await verifyProjectOrg(workspaceId, projectId))) return [];

  const result = await db
    .select()
    .from(projectNotes)
    .where(eq(projectNotes.projectId, projectId))
    .orderBy(projectNotes.order);

  return result as ProjectNote[];
};

// Get a single note by ID
export const getNoteById = async (
  workspaceId: string,
  id: string
): Promise<ProjectNote | null> => {
  const [note] = await db
    .select({
      id: projectNotes.id,
      projectId: projectNotes.projectId,
      title: projectNotes.title,
      content: projectNotes.content,
      order: projectNotes.order,
      createdAt: projectNotes.createdAt,
      updatedAt: projectNotes.updatedAt,
    })
    .from(projectNotes)
    .innerJoin(projects, eq(projectNotes.projectId, projects.id))
    .where(and(eq(projectNotes.id, id), eq(projects.workspaceId, workspaceId)))
    .limit(1);

  if (!note) return null;

  return note as ProjectNote;
};

// Create a note
export const createNote = async (
  workspaceId: string,
  projectId: string,
  data: CreateNoteRequest
): Promise<ProjectNote> => {
  if (!(await verifyProjectOrg(workspaceId, projectId))) {
    throw new Error("Project not found or does not belong to workspace");
  }

  const [newNote] = await db
    .insert(projectNotes)
    .values({
      projectId,
      title: data.title,
      content: data.content,
      order: data.order ?? 0,
    })
    .returning();

  return newNote as ProjectNote;
};

// Update a note
export const updateNote = async (
  workspaceId: string,
  id: string,
  data: UpdateNoteRequest
): Promise<ProjectNote | null> => {
  // Verify note belongs to org via project
  const [existing] = await db
    .select({ id: projectNotes.id })
    .from(projectNotes)
    .innerJoin(projects, eq(projectNotes.projectId, projects.id))
    .where(and(eq(projectNotes.id, id), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return null;

  const [updated] = await db
    .update(projectNotes)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(projectNotes.id, id))
    .returning();

  if (!updated) return null;

  return updated as ProjectNote;
};

// Delete a note
export const deleteNote = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  // Verify note belongs to org via project
  const [existing] = await db
    .select({ id: projectNotes.id })
    .from(projectNotes)
    .innerJoin(projects, eq(projectNotes.projectId, projects.id))
    .where(and(eq(projectNotes.id, id), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) return false;

  const result = await db
    .delete(projectNotes)
    .where(eq(projectNotes.id, id))
    .returning();
  return result.length > 0;
};

// Reorder notes for a project
export const reorderNotes = async (
  workspaceId: string,
  projectId: string,
  noteIds: string[]
): Promise<void> => {
  if (!(await verifyProjectOrg(workspaceId, projectId))) return;

  await Promise.all(
    noteIds.map((noteId, index) =>
      db
        .update(projectNotes)
        .set({ order: index, updatedAt: new Date() })
        .where(
          and(
            eq(projectNotes.id, noteId),
            eq(projectNotes.projectId, projectId)
          )
        )
    )
  );
};
