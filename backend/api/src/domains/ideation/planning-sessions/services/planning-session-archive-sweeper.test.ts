import { describe, expect, it } from "bun:test";
import type { EventArchiveDb } from "@almirant/database";
import {
  runPlanningSessionArchiveSweeperOnce,
  type PlanningSessionArchiveSweeperDeps,
} from "./planning-session-archive-sweeper";

const completedSession = {
  id: "ps-1",
  organizationId: "org-1",
  projectId: "project-1",
  boardId: "board-1",
  title: "Archived planning session",
  status: "completed" as const,
  config: null,
  result: { summary: "done" },
  createdByUserId: "user-1",
  totalInputTokens: 12,
  totalOutputTokens: 8,
  estimatedCost: "0.12",
  durationMs: 20_000,
  completedAt: new Date("2026-01-01T10:00:00.000Z"),
  createdAt: new Date("2026-01-01T09:00:00.000Z"),
  updatedAt: new Date("2026-01-01T10:00:00.000Z"),
  seedCount: 0,
  workItemCount: 0,
  createdByUserName: "User",
  createdByUserImage: null,
  projectName: "Project",
  boardName: "Board",
};

const canonicalEvents = [
  {
    id: "evt-1",
    agentJobId: "job-1",
    planningSessionId: completedSession.id,
    sequenceNum: 1,
    kind: "agent.text",
    payload: { kind: "agent.text", content: "hola" },
    provider: "codex",
    createdAt: new Date("2026-01-01T09:00:00.000Z"),
  },
];

const nativeEvents = [
  {
    id: "native-1",
    agentJobId: "job-1",
    planningSessionId: completedSession.id,
    sequenceNum: 1,
    nativeEventType: "thread.message.delta",
    sourceFormat: "sse",
    provider: "codex",
    codingAgent: "codex",
    runtimeSessionId: "runtime-1",
    payload: { event: "thread.message.delta" },
    emittedAt: new Date("2026-01-01T09:00:00.000Z"),
    receivedAt: new Date("2026-01-01T09:00:00.000Z"),
    createdAt: new Date("2026-01-01T09:00:00.000Z"),
  },
];

const userInputs = [
  {
    jobId: "job-1",
    message: "Planifica esto",
    payload: { source: "planning:start" },
    timestamp: new Date("2026-01-01T08:59:59.000Z"),
  },
];

const createDeps = (overrides?: {
  archiveConfigured?: boolean;
  sessionEvents?: typeof canonicalEvents;
  nativeEvents?: typeof nativeEvents;
  sessionSnapshot?: Record<string, unknown> | null;
}) => {
  const archiveMap = new Map<string, EventArchiveDb>();
  let storedSnapshot = overrides?.sessionSnapshot ?? null;
  let sessionEventsRows = [...(overrides?.sessionEvents ?? canonicalEvents)];
  let nativeEventRows = [...(overrides?.nativeEvents ?? nativeEvents)];

  return {
    deps: {
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      isArchiveConfigured: () => overrides?.archiveConfigured ?? true,
      getPlanningSessionsEligibleForArchive: async () => [
        {
          id: completedSession.id,
          status: "completed" as const,
          completedAt: completedSession.completedAt,
          updatedAt: completedSession.updatedAt,
        },
      ],
      getPlanningSessionById: async () => completedSession,
      getSessionSnapshot: async () =>
        storedSnapshot
          ? ({
              id: "snapshot-1",
              planningSessionId: completedSession.id,
              projectorVersion: Number(storedSnapshot.projectorVersion ?? 1),
              lastCanonicalSeq: Number(storedSnapshot.lastCanonicalSeq ?? 0),
              timeline: storedSnapshot.timeline as Record<string, unknown>,
              summary: (storedSnapshot.summary as Record<string, unknown> | null) ?? null,
              metrics: (storedSnapshot.metrics as Record<string, unknown> | null) ?? null,
              createdAt: new Date("2026-01-01T10:00:00.000Z"),
              updatedAt: new Date("2026-01-01T10:00:00.000Z"),
            })
          : null,
      upsertSessionSnapshot: async (input: Record<string, unknown>) => {
        storedSnapshot = {
          projectorVersion: input.projectorVersion,
          lastCanonicalSeq: input.lastCanonicalSeq,
          timeline: input.timeline,
          summary: input.summary ?? null,
          metrics: input.metrics ?? null,
        };
        return {
          id: "snapshot-1",
          planningSessionId: completedSession.id,
          projectorVersion: input.projectorVersion as number,
          lastCanonicalSeq: input.lastCanonicalSeq as number,
          timeline: input.timeline as Record<string, unknown>,
          summary: (input.summary as Record<string, unknown> | null) ?? null,
          metrics: (input.metrics as Record<string, unknown> | null) ?? null,
          createdAt: new Date("2026-01-01T10:00:00.000Z"),
          updatedAt: new Date("2026-01-01T10:00:00.000Z"),
        };
      },
      getLatestJobForPlanningSession: async () => ({
        id: "job-1",
        codingAgent: "codex",
        aiProvider: "openai",
        provider: "codex",
        model: "o3",
      }),
      getPlanningSessionUserInputs: async () => userInputs,
      getSessionEventsBySessionId: async (_sessionId: string, filters?: { afterSequence?: number }) =>
        sessionEventsRows.filter((event) =>
          filters?.afterSequence === undefined || event.sequenceNum > filters.afterSequence,
        ),
      getAgentNativeEventsBySessionId: async (_sessionId: string, filters?: { afterSequence?: number }) =>
        nativeEventRows.filter((event) =>
          filters?.afterSequence === undefined || event.sequenceNum > filters.afterSequence,
        ),
      getEventArchiveBySessionAndKind: async (sessionId: string, archiveKind: string) =>
        archiveMap.get(`${sessionId}:${archiveKind}`) ?? null,
      upsertEventArchive: async (input: Record<string, unknown>) => {
        const row = {
          id: `archive-${String(input.archiveKind)}`,
          planningSessionId: String(input.planningSessionId),
          archiveKind: String(input.archiveKind),
          storageBucket: String(input.storageBucket ?? "private-bucket"),
          storageKey: String(input.storageKey),
          storageUrl: String(input.storageUrl ?? ""),
          format: String(input.format),
          compression: String(input.compression ?? "gzip"),
          contentType: String(input.contentType ?? "application/gzip"),
          rowCount: Number(input.rowCount ?? 0),
          lastSequenceNum:
            input.lastSequenceNum === undefined ? null : Number(input.lastSequenceNum),
          projectorVersion:
            input.projectorVersion === undefined ? null : Number(input.projectorVersion),
          checksumSha256: String(input.checksumSha256),
          archivedAt: new Date("2026-01-02T10:00:00.000Z"),
          createdAt: new Date("2026-01-02T10:00:00.000Z"),
          updatedAt: new Date("2026-01-02T10:00:00.000Z"),
        } satisfies EventArchiveDb;
        archiveMap.set(`${row.planningSessionId}:${row.archiveKind}`, row);
        return row;
      },
      uploadCanonicalEventsArchive: async () => ({
        storageBucket: "private-bucket",
        storageKey: "planning-sessions/ps-1/canonical_events.ndjson.gz",
        storageUrl: "https://storage.example.com/planning-sessions/ps-1/canonical_events.ndjson.gz",
        format: "ndjson" as const,
        compression: "gzip" as const,
        contentType: "application/gzip" as const,
        rowCount: sessionEventsRows.length,
        lastSequenceNum: sessionEventsRows.at(-1)?.sequenceNum ?? null,
        projectorVersion: null,
        checksumSha256: "canonical-checksum",
      }),
      uploadNativeEventsArchive: async () => ({
        storageBucket: "private-bucket",
        storageKey: "planning-sessions/ps-1/native_events.ndjson.gz",
        storageUrl: "https://storage.example.com/planning-sessions/ps-1/native_events.ndjson.gz",
        format: "ndjson" as const,
        compression: "gzip" as const,
        contentType: "application/gzip" as const,
        rowCount: nativeEventRows.length,
        lastSequenceNum: nativeEventRows.at(-1)?.sequenceNum ?? null,
        projectorVersion: null,
        checksumSha256: "native-checksum",
      }),
      uploadSessionSnapshotArchive: async () => ({
        storageBucket: "private-bucket",
        storageKey: "planning-sessions/ps-1/session_snapshot.json.gz",
        storageUrl: "https://storage.example.com/planning-sessions/ps-1/session_snapshot.json.gz",
        format: "json" as const,
        compression: "gzip" as const,
        contentType: "application/gzip" as const,
        rowCount: 1,
        lastSequenceNum: Number(storedSnapshot?.lastCanonicalSeq ?? 0),
        projectorVersion: Number(storedSnapshot?.projectorVersion ?? 1),
        checksumSha256: "snapshot-checksum",
      }),
      deleteSessionEventsBySessionId: async () => {
        const deleted = sessionEventsRows.length;
        sessionEventsRows = [];
        return deleted;
      },
      deleteAgentNativeEventsBySessionId: async () => {
        const deleted = nativeEventRows.length;
        nativeEventRows = [];
        return deleted;
      },
      } as PlanningSessionArchiveSweeperDeps,
    getStoredSnapshot: () => storedSnapshot,
    getArchives: () => [...archiveMap.values()],
    getSessionEventsRows: () => sessionEventsRows,
    getNativeEventRows: () => nativeEventRows,
  };
};

describe("planning-session-archive-sweeper", () => {
  it("skips the sweep when archive storage is not configured", async () => {
    const { deps } = createDeps({ archiveConfigured: false });

    const result = await runPlanningSessionArchiveSweeperOnce(
      {
        nativeRetentionDays: 30,
        canonicalRetentionDays: 90,
      },
      deps,
    );

    expect(result.skippedNoStorage).toBe(true);
    expect(result.sessionsScanned).toBe(0);
  });

  it("does not purge canonical events when no recoverable snapshot can be produced", async () => {
    const { deps, getSessionEventsRows } = createDeps({ sessionEvents: [] });

    const result = await runPlanningSessionArchiveSweeperOnce(
      {
        nativeRetentionDays: 30,
        canonicalRetentionDays: 30,
      },
      deps,
    );

    expect(result.canonicalArchivesCreated).toBe(0);
    expect(result.canonicalRowsDeleted).toBe(0);
    expect(getSessionEventsRows()).toHaveLength(0);
  });

  it("archives snapshot, canonical events and native events before purging hot rows", async () => {
    const { deps, getStoredSnapshot, getArchives, getSessionEventsRows, getNativeEventRows } =
      createDeps();

    const result = await runPlanningSessionArchiveSweeperOnce(
      {
        nativeRetentionDays: 30,
        canonicalRetentionDays: 90,
      },
      deps,
    );

    expect(result.snapshotArchivesCreated).toBe(1);
    expect(result.canonicalArchivesCreated).toBe(1);
    expect(result.nativeArchivesCreated).toBe(1);
    expect(result.canonicalRowsDeleted).toBe(1);
    expect(result.nativeRowsDeleted).toBe(1);
    expect(getStoredSnapshot()).not.toBeNull();
    expect(getArchives().map((archive) => archive.archiveKind).sort()).toEqual([
      "canonical_events",
      "native_events",
      "session_snapshot",
    ]);
    expect(getSessionEventsRows()).toHaveLength(0);
    expect(getNativeEventRows()).toHaveLength(0);
  });
});
