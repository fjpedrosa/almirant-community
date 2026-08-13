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
  uploadAgentJobNativeEventsArchive: async () => ({
    storageBucket: null,
    storageKey: "agent-jobs/job-1/native_events.ndjson.gz",
    storageUrl: null,
    format: "ndjson" as const,
    compression: "gzip" as const,
    contentType: "application/gzip" as const,
    rowCount: 2,
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
        uploadAgentJobNativeEventsArchive: async (jobId) => {
          uploaded.push(jobId);
          return {
            storageBucket: null,
            storageKey: `agent-jobs/${jobId}/native_events.ndjson.gz`,
            storageUrl: null,
            format: "ndjson",
            compression: "gzip",
            contentType: "application/gzip",
            rowCount: 2,
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

  test("retries metadata after an identical archive publication", async () => {
    let attempts = 0; let deleted = 0;
    const deps = makeDeps({
      upsertAgentJobEventArchive: async () => { if (++attempts === 1) throw new Error("metadata unavailable"); return {} as never; },
      deleteAgentNativeEventsByJobId: async () => { deleted += 1; return 2; },
    });
    const first = await runAgentJobNativeArchiveSweeperOnce({}, deps);
    const second = await runAgentJobNativeArchiveSweeperOnce({}, deps);
    expect(first.failures).toBe(1);
    expect(second.failures).toBe(0);
    expect(attempts).toBe(2);
    expect(deleted).toBe(1);
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

test("streams a large history in bounded pages without retaining every event", async () => {
  const pageSize = 100;
  const totalEvents = 2_500;
  let uploadCount = 0;
  let largestPage = 0;

  const stats = await runAgentJobNativeArchiveSweeperOnce(
    { eventPageSize: pageSize },
    makeDeps({
      getAgentNativeEventsByJobId: async (_jobId, filters) => {
        const after = filters?.afterSequence ?? 0;
        if (after >= totalEvents) return [];
        const start = after + 1;
        const end = Math.min(start + pageSize - 1, totalEvents);
        return Array.from({ length: end - start + 1 }, (_, offset) => makeEvent(start + offset));
      },
      uploadAgentJobNativeEventsArchive: async (_jobId, pages) => {
        for await (const page of pages) {
          largestPage = Math.max(largestPage, page.length);
          uploadCount += page.length;
        }
        return {
          storageBucket: null,
          storageKey: "agent-jobs/job-1/native_events.ndjson.gz",
          storageUrl: null,
          format: "ndjson",
          compression: "gzip",
          contentType: "application/gzip",
          rowCount: uploadCount,
          lastSequenceNum: totalEvents,
          checksumSha256: "abc",
        };
      },
    }),
  );

  expect(stats.failures).toBe(0);
  expect(uploadCount).toBe(totalEvents);
  expect(largestPage).toBeLessThanOrEqual(pageSize);
});
