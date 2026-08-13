import { describe, expect, test } from "bun:test";
import type { AgentJobNativeArchiveSweeperDeps } from "./agent-job-native-archive-sweeper";
import { runAgentJobNativeArchiveSweeperOnce } from "./agent-job-native-archive-sweeper";

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const makeEvent = (sequenceNum: number) =>
  ({
    id: `event-${sequenceNum}`,
    agentJobId: "job-1",
    planningSessionId: null,
    sequenceNum,
    nativeEventType: "message",
    sourceFormat: "sse",
    provider: null,
    codingAgent: null,
    runtimeSessionId: null,
    payload: { text: "hello" },
    emittedAt: null,
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }) as never;

const drain = async (events: AsyncIterable<unknown>): Promise<number> => {
  let rowCount = 0;
  for await (const _event of events) rowCount += 1;
  return rowCount;
};

const makeDeps = (
  overrides: Partial<AgentJobNativeArchiveSweeperDeps> = {},
): AgentJobNativeArchiveSweeperDeps => ({
  logger: silentLogger,
  getAgentJobsEligibleForNativeArchive: async () => [
    { id: "job-1", archivableAt: new Date("2026-01-01T00:00:00Z") },
  ],
  getAgentJobEventArchive: async () => null,
  getAgentNativeEventsByJobId: async (_jobId, filters) =>
    filters?.afterSequence === undefined ? [makeEvent(1), makeEvent(2)] : [],
  uploadAgentJobNativeEventsArchive: async (jobId, events) => ({
    storageBucket: null,
    storageKey: `agent-jobs/${jobId}/native_events.ndjson.gz`,
    storageUrl: null,
    format: "ndjson" as const,
    compression: "gzip" as const,
    contentType: "application/gzip" as const,
    rowCount: await drain(events),
    lastSequenceNum: 2,
    checksumSha256: "abc",
  }),
  upsertAgentJobEventArchive: async () => ({}) as never,
  deleteAgentNativeEventsByJobId: async () => 2,
  ...overrides,
});

describe("agent job native archive sweeper", () => {
  test("archives a terminal job's events and then deletes them", async () => {
    const uploaded: string[] = [];
    const deleted: string[] = [];

    const stats = await runAgentJobNativeArchiveSweeperOnce(
      {},
      makeDeps({
        uploadAgentJobNativeEventsArchive: async (jobId, events) => {
          uploaded.push(jobId);
          return {
            storageBucket: null,
            storageKey: `agent-jobs/${jobId}/native_events.ndjson.gz`,
            storageUrl: null,
            format: "ndjson",
            compression: "gzip",
            contentType: "application/gzip",
            rowCount: await drain(events),
            lastSequenceNum: 2,
            checksumSha256: "abc",
          };
        },
        deleteAgentNativeEventsByJobId: async (jobId) => {
          deleted.push(jobId);
          return 2;
        },
      }),
    );

    expect(uploaded).toEqual(["job-1"]);
    expect(deleted).toEqual(["job-1"]);
    expect(stats.archivesCreated).toBe(1);
    expect(stats.rowsDeleted).toBe(2);
  });

  test("streams a huge job page by page instead of materialising it", async () => {
    const pageSize = 100;
    const totalEvents = 25_000;
    let peakPageSize = 0;

    const stats = await runAgentJobNativeArchiveSweeperOnce(
      { eventPageSize: pageSize },
      makeDeps({
        getAgentNativeEventsByJobId: async (_jobId, filters) => {
          const from = filters?.afterSequence ?? 0;
          if (from >= totalEvents) return [];
          const page = Array.from(
            { length: Math.min(pageSize, totalEvents - from) },
            (_unused, index) => makeEvent(from + index + 1),
          );
          peakPageSize = Math.max(peakPageSize, page.length);
          return page;
        },
        deleteAgentNativeEventsByJobId: async () => totalEvents,
      }),
    );

    expect(peakPageSize).toBe(pageSize);
    expect(stats.archivesCreated).toBe(1);
    expect(stats.rowsDeleted).toBe(totalEvents);
    expect(stats.failures).toBe(0);
  });

  test("keeps the events when the upload fails", async () => {
    const deleted: string[] = [];

    const stats = await runAgentJobNativeArchiveSweeperOnce(
      {},
      makeDeps({
        uploadAgentJobNativeEventsArchive: async () => {
          throw new Error("storage unavailable");
        },
        deleteAgentNativeEventsByJobId: async (jobId) => {
          deleted.push(jobId);
          return 2;
        },
      }),
    );

    expect(deleted).toEqual([]);
    expect(stats.rowsDeleted).toBe(0);
    expect(stats.failures).toBe(1);
  });

  test("one failing job does not stop the rest of the batch", async () => {
    const deleted: string[] = [];

    const stats = await runAgentJobNativeArchiveSweeperOnce(
      {},
      makeDeps({
        getAgentJobsEligibleForNativeArchive: async () => [
          { id: "job-bad", archivableAt: new Date("2026-01-01T00:00:00Z") },
          { id: "job-good", archivableAt: new Date("2026-01-01T00:00:00Z") },
        ],
        uploadAgentJobNativeEventsArchive: async (jobId, events) => {
          if (jobId === "job-bad") throw new Error("Out of memory");
          return {
            storageBucket: null,
            storageKey: `agent-jobs/${jobId}/native_events.ndjson.gz`,
            storageUrl: null,
            format: "ndjson",
            compression: "gzip",
            contentType: "application/gzip",
            rowCount: await drain(events),
            lastSequenceNum: 2,
            checksumSha256: "abc",
          };
        },
        deleteAgentNativeEventsByJobId: async (jobId) => {
          deleted.push(jobId);
          return 2;
        },
      }),
    );

    expect(deleted).toEqual(["job-good"]);
    expect(stats.failures).toBe(1);
    expect(stats.archivesCreated).toBe(1);
  });

  test("skips re-uploading when an archive already exists but still purges", async () => {
    const uploaded: string[] = [];
    const deleted: string[] = [];

    await runAgentJobNativeArchiveSweeperOnce(
      {},
      makeDeps({
        getAgentJobEventArchive: async () => ({ id: "archive-1" }) as never,
        uploadAgentJobNativeEventsArchive: async (jobId) => {
          uploaded.push(jobId);
          return {} as never;
        },
        deleteAgentNativeEventsByJobId: async (jobId) => {
          deleted.push(jobId);
          return 2;
        },
      }),
    );

    expect(uploaded).toEqual([]);
    expect(deleted).toEqual(["job-1"]);
  });

  test("does nothing when no job is past the cutoff", async () => {
    const stats = await runAgentJobNativeArchiveSweeperOnce(
      {},
      makeDeps({ getAgentJobsEligibleForNativeArchive: async () => [] }),
    );

    expect(stats.jobsScanned).toBe(0);
    expect(stats.archivesCreated).toBe(0);
    expect(stats.rowsDeleted).toBe(0);
  });

  test("passes the retention cutoff to the eligibility query", async () => {
    let receivedCutoff: Date | null = null;

    await runAgentJobNativeArchiveSweeperOnce(
      { retentionDays: 30 },
      makeDeps({
        getAgentJobsEligibleForNativeArchive: async (before) => {
          receivedCutoff = before;
          return [];
        },
      }),
    );

    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(receivedCutoff).not.toBeNull();
    expect(Math.abs(receivedCutoff!.getTime() - expected)).toBeLessThan(5_000);
  });
});
