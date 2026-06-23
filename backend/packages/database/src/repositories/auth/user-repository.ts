import { db } from "../../client";
import { user } from "../../schema/auth";
import { member } from "../../schema/organization";
import { eq, ilike, or, sql } from "drizzle-orm";

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

export const getMembersByOrganizationId = async (organizationId: string) => {
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
    .where(eq(member.organizationId, organizationId))
    .orderBy(member.createdAt);

  return rows;
};
