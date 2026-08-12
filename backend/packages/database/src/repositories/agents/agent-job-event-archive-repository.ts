import { and, asc, eq, exists, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../client";
import {
  agentJobEventArchives,
  agentJobs,
  agentNativeEvents,
  type AgentJobEventArchiveDb,
  type NewAgentJobEventArchive,
} from "../../schema";

const TERMINAL_JOB_STATUSES = [
  "completed",
  "incomplete",
  "failed",
  "cancelled",
] as const;

export interface AgentJobNativeArchiveCandidate {
  id: string;
  archivableAt: Date;
}

export const getAgentJobEventArchive = async (
  agentJobId: string,
  archiveKind: string,
): Promise<AgentJobEventArchiveDb | null> => {
  const [row] = await db
    .select()
    .from(agentJobEventArchives)
    .where(
      and(
        eq(agentJobEventArchives.agentJobId, agentJobId),
        eq(agentJobEventArchives.archiveKind, archiveKind),
      ),
    )
    .limit(1);

  return row ?? null;
};

export const upsertAgentJobEventArchive = async (
  archive: NewAgentJobEventArchive,
): Promise<AgentJobEventArchiveDb> => {
  const now = new Date();
  const [row] = await db
    .insert(agentJobEventArchives)
    .values({
      ...archive,
      archivedAt: archive.archivedAt ?? now,
      createdAt: archive.createdAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [agentJobEventArchives.agentJobId, agentJobEventArchives.archiveKind],
      set: {
        storageBucket: archive.storageBucket ?? null,
        storageKey: archive.storageKey,
        storageUrl: archive.storageUrl ?? null,
        format: archive.format,
        compression: archive.compression ?? "gzip",
        contentType: archive.contentType ?? null,
        rowCount: archive.rowCount ?? 0,
        lastSequenceNum: archive.lastSequenceNum ?? null,
        checksumSha256: archive.checksumSha256,
        archivedAt: archive.archivedAt ?? now,
        updatedAt: now,
      },
    })
    .returning();

  return row!;
};

// Terminal-only: a running job would be archived mid-stream and then purged.
export const getAgentJobsEligibleForNativeArchive = async (
  before: Date,
  limit: number,
): Promise<AgentJobNativeArchiveCandidate[]> => {
  const rows = await db
    .select({
      id: agentJobs.id,
      completedAt: agentJobs.completedAt,
      updatedAt: agentJobs.updatedAt,
    })
    .from(agentJobs)
    .where(
      and(
        inArray(agentJobs.status, [...TERMINAL_JOB_STATUSES]),
        lte(sql`coalesce(${agentJobs.completedAt}, ${agentJobs.updatedAt})`, before),
        exists(
          db
            .select({ one: sql`1` })
            .from(agentNativeEvents)
            .where(eq(agentNativeEvents.agentJobId, agentJobs.id)),
        ),
      ),
    )
    .orderBy(asc(sql`coalesce(${agentJobs.completedAt}, ${agentJobs.updatedAt})`))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    archivableAt: row.completedAt ?? row.updatedAt,
  }));
};
