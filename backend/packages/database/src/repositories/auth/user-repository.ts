import { db } from "../../client";
import { user } from "../../schema/auth";
import { member } from "../../schema/workspace";
import { and, eq, ilike, or, sql } from "drizzle-orm";

export const getUserById = async (id: string) => {
  const [result] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  return result ?? null;
};

export const getUserByEmail = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const [result] = await db
    .select()
    .from(user)
    .where(sql`lower(${user.email}) = ${normalized}`)
    .limit(1);
  return result ?? null;
};

export const findUsersByQuery = async (query: string, limit = 5) => {
  const q = query.trim();
  if (!q) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 20);

  return db
    .select()
    .from(user)
    .where(or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`)))
    .limit(safeLimit);
};

export const updateUserLocale = async (userId: string, locale: string) => {
  const [result] = await db
    .update(user)
    .set({ locale, updatedAt: new Date() })
    .where(eq(user.id, userId))
    .returning();
  return result ?? null;
};

export const getMembersByWorkspaceId = async (workspaceId: string) => {
  const rows = await db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.workspaceId, workspaceId))
    .orderBy(member.createdAt);

  return rows;
};

export const isUserWorkspaceMember = async (
  userId: string,
  workspaceId: string,
): Promise<boolean> => {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(row);
};

/**
 * Resolve the workspace's owner user id, for attributing automated dispatch
 * (the scheduled-agent-dispatcher tick) to a real member instead of
 * persisting `createdByUserId: null` -- which the sessions UI renders as
 * "Almirant[bot]" even when the workspace has a real owner. Used as a
 * fallback only: new `scheduled_agent_configs` rows always carry an
 * `ownerUserId`, so this is exercised by legacy rows predating that
 * enforcement.
 */
export const getWorkspaceOwnerUserId = async (
  workspaceId: string,
): Promise<string | null> => {
  const [row] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.role, "owner")))
    .orderBy(member.createdAt)
    .limit(1);
  return row?.userId ?? null;
};
