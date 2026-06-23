import { and, desc, eq } from "drizzle-orm";
import { db } from "../../client";
import {
  eventArchives,
  type EventArchiveDb,
  type NewEventArchive,
} from "../../schema";

export const getEventArchiveBySessionAndKind = async (
  planningSessionId: string,
  archiveKind: string,
): Promise<EventArchiveDb | null> => {
  const [row] = await db
    .select()
    .from(eventArchives)
    .where(
      and(
        eq(eventArchives.planningSessionId, planningSessionId),
        eq(eventArchives.archiveKind, archiveKind),
      ),
    )
    .limit(1);

  return row ?? null;
};

export const listEventArchivesBySessionId = async (
  planningSessionId: string,
): Promise<EventArchiveDb[]> =>
  db
    .select()
    .from(eventArchives)
    .where(eq(eventArchives.planningSessionId, planningSessionId))
    .orderBy(desc(eventArchives.archivedAt));

export const upsertEventArchive = async (
  archive: NewEventArchive,
): Promise<EventArchiveDb> => {
  const now = new Date();
  const [row] = await db
    .insert(eventArchives)
    .values({
      ...archive,
      archivedAt: archive.archivedAt ?? now,
      createdAt: archive.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [eventArchives.planningSessionId, eventArchives.archiveKind],
      set: {
        storageBucket: archive.storageBucket ?? null,
        storageKey: archive.storageKey,
        storageUrl: archive.storageUrl ?? null,
        format: archive.format,
        compression: archive.compression ?? "gzip",
        contentType: archive.contentType ?? null,
        rowCount: archive.rowCount ?? 0,
        lastSequenceNum: archive.lastSequenceNum ?? null,
        projectorVersion: archive.projectorVersion ?? null,
        checksumSha256: archive.checksumSha256,
        archivedAt: archive.archivedAt ?? now,
        updatedAt: now,
      },
    })
    .returning();

  return row!;
};
