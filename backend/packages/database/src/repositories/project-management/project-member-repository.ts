import { db } from "../../client";
import { projectMembers, projects, user } from "../../schema";
import { eq, and, sql } from "drizzle-orm";

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: string = "member"
) {
  const result = await db
    .insert(projectMembers)
    .values({
      projectId,
      userId,
      role: role as "owner" | "admin" | "member" | "viewer",
    })
    .onConflictDoNothing({
      target: [projectMembers.projectId, projectMembers.userId],
    })
    .returning();

  return result[0] ?? null;
}

export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      )
    )
    .returning({ id: projectMembers.id });

  return result.length > 0;
}

export async function getProjectMembers(projectId: string) {
  return db
    .select({
      id: projectMembers.id,
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(projectMembers)
    .innerJoin(user, eq(projectMembers.userId, user.id))
    .where(eq(projectMembers.projectId, projectId));
}

export async function getAccessibleProjectIds(
  userId: string,
  orgId: string
): Promise<string[]> {
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projects.organizationId, orgId)
      )
    );

  return rows.map((r) => r.projectId);
}

export async function isProjectMember(
  projectId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      )
    )
    .limit(1);

  return result.length > 0;
}

export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: string
) {
  const result = await db
    .update(projectMembers)
    .set({
      role: role as "owner" | "admin" | "member" | "viewer",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId)
      )
    )
    .returning();

  return result[0] ?? null;
}

export async function bulkAddProjectMembers(
  projectId: string,
  userIds: string[],
  role: string = "member"
) {
  if (userIds.length === 0) return [];

  const values = userIds.map((userId) => ({
    projectId,
    userId,
    role: role as "owner" | "admin" | "member" | "viewer",
  }));

  return db
    .insert(projectMembers)
    .values(values)
    .onConflictDoNothing({
      target: [projectMembers.projectId, projectMembers.userId],
    })
    .returning();
}
