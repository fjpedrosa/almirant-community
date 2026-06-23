import { db } from "../../client";
import { userViewPreferences } from "../../schema";
import { eq, and } from "drizzle-orm";

// Get view preferences for a specific user and page
export const getViewPreference = async (
  userId: string,
  pageKey: string
): Promise<Record<string, unknown> | null> => {
  const [result] = await db
    .select({ config: userViewPreferences.config })
    .from(userViewPreferences)
    .where(
      and(
        eq(userViewPreferences.userId, userId),
        eq(userViewPreferences.pageKey, pageKey)
      )
    )
    .limit(1);

  return result?.config ?? null;
};

// Upsert view preferences for a specific user and page
export const upsertViewPreference = async (
  userId: string,
  pageKey: string,
  config: Record<string, unknown>
): Promise<void> => {
  await db
    .insert(userViewPreferences)
    .values({
      userId,
      pageKey,
      config,
    })
    .onConflictDoUpdate({
      target: [userViewPreferences.userId, userViewPreferences.pageKey],
      set: {
        config,
        updatedAt: new Date(),
      },
    });
};
