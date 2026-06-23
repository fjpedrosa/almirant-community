import { db } from "../../client";
import { manifestStates } from "../../schema";
import { eq, and, gt, lt } from "drizzle-orm";
import type {
  NewManifestState,
  ManifestState,
} from "../../schema/manifest-states";

export const createManifestState = async (
  data: Omit<NewManifestState, "id" | "createdAt">,
): Promise<ManifestState> => {
  const [created] = await db.insert(manifestStates).values(data).returning();

  if (!created) throw new Error("Failed to create manifest state");
  return created;
};

export const getActiveManifestState = async (
  state: string,
): Promise<ManifestState | null> => {
  const [row] = await db
    .select()
    .from(manifestStates)
    .where(
      and(
        eq(manifestStates.state, state),
        gt(manifestStates.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
};

export const deleteManifestStateByState = async (
  state: string,
): Promise<void> => {
  await db.delete(manifestStates).where(eq(manifestStates.state, state));
};

export const cleanExpiredManifestStates = async (): Promise<number> => {
  const deleted = await db
    .delete(manifestStates)
    .where(lt(manifestStates.expiresAt, new Date()))
    .returning();

  return deleted.length;
};
