import { db } from "../../client";
import { oauthStates } from "../../schema";
import { eq, and, gt, lt } from "drizzle-orm";
import type { NewOAuthState, OAuthState } from "../../schema/oauth-states";

export const createOAuthState = async (
  data: Omit<NewOAuthState, "id" | "createdAt">
): Promise<OAuthState> => {
  const [created] = await db
    .insert(oauthStates)
    .values(data)
    .returning();

  if (!created) throw new Error("Failed to create OAuth state");
  return created;
};

export const getOAuthStateByState = async (
  state: string
): Promise<OAuthState | null> => {
  const [row] = await db
    .select()
    .from(oauthStates)
    .where(
      and(
        eq(oauthStates.state, state),
        gt(oauthStates.expiresAt, new Date())
      )
    )
    .limit(1);

  return row ?? null;
};

export const deleteOAuthState = async (id: string): Promise<void> => {
  await db.delete(oauthStates).where(eq(oauthStates.id, id));
};

export const cleanExpiredOAuthStates = async (): Promise<number> => {
  const deleted = await db
    .delete(oauthStates)
    .where(lt(oauthStates.expiresAt, new Date()))
    .returning();

  return deleted.length;
};
