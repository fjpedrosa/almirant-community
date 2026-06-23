import { eq } from "drizzle-orm";
import { db } from "../../client";
import {
  sessionCheckpoints,
  sessionSnapshots,
  type NewSessionCheckpoint,
  type NewSessionSnapshot,
  type SessionCheckpointDb,
  type SessionSnapshotDb,
} from "../../schema";

export const getSessionCheckpoint = async (
  planningSessionId: string,
): Promise<SessionCheckpointDb | null> => {
  const [row] = await db
    .select()
    .from(sessionCheckpoints)
    .where(eq(sessionCheckpoints.planningSessionId, planningSessionId))
    .limit(1);

  return row ?? null;
};

export const upsertSessionCheckpoint = async (
  checkpoint: NewSessionCheckpoint,
): Promise<SessionCheckpointDb> => {
  const now = new Date();
  const [row] = await db
    .insert(sessionCheckpoints)
    .values({
      ...checkpoint,
      createdAt: checkpoint.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionCheckpoints.planningSessionId,
      set: {
        projectorVersion: checkpoint.projectorVersion,
        lastCanonicalSeq: checkpoint.lastCanonicalSeq,
        timeline: checkpoint.timeline,
        updatedAt: now,
      },
    })
    .returning();

  return row!;
};

export const getSessionSnapshot = async (
  planningSessionId: string,
): Promise<SessionSnapshotDb | null> => {
  const [row] = await db
    .select()
    .from(sessionSnapshots)
    .where(eq(sessionSnapshots.planningSessionId, planningSessionId))
    .limit(1);

  return row ?? null;
};

export const upsertSessionSnapshot = async (
  snapshot: NewSessionSnapshot,
): Promise<SessionSnapshotDb> => {
  const now = new Date();
  const [row] = await db
    .insert(sessionSnapshots)
    .values({
      ...snapshot,
      createdAt: snapshot.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionSnapshots.planningSessionId,
      set: {
        projectorVersion: snapshot.projectorVersion,
        lastCanonicalSeq: snapshot.lastCanonicalSeq,
        timeline: snapshot.timeline,
        summary: snapshot.summary ?? null,
        metrics: snapshot.metrics ?? null,
        updatedAt: now,
      },
    })
    .returning();

  return row!;
};
