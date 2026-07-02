import { db, schema, eq } from "@almirant/database";

/**
 * Resolve a user's workspace for Telegram commands.
 * We use the first membership as a pragmatic default for now.
 */
export const getWorkspaceIdForUser = async (
  userId: string
): Promise<string | null> => {
  const [membership] = await db
    .select({ workspaceId: schema.member.workspaceId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);

  return membership?.workspaceId ?? null;
};
