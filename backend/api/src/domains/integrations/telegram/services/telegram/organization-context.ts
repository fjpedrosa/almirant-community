import { db, schema, eq } from "@almirant/database";

/**
 * Resolve a user's organization for Telegram commands.
 * We use the first membership as a pragmatic default for now.
 */
export const getOrganizationIdForUser = async (
  userId: string
): Promise<string | null> => {
  const [membership] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);

  return membership?.organizationId ?? null;
};
