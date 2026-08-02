import { describe, expect, mock, test } from "bun:test";
import type { QueuedReceiptResidueCandidate } from "@almirant/database";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

const {
  runQueuedReceiptResidueSweepOnce,
  startQueuedReceiptResidueReconciler,
} = await import("./queued-receipt-residue-reconciler");

const candidate = (jobId: string): QueuedReceiptResidueCandidate => ({
  jobId,
  updatedAtMarker: "2026-07-24 10:00:00+00",
  claimAttemptMarker: '"claim-attempt"',
  sequenceHighWaterMarker: "null",
  receiptMarker: "[]",
});

describe("queued receipt-residue reconciler", () => {
  test("reports selected, terminalized, and CAS-race counters without payloads", async () => {
    const findCandidates = mock(async () => [
      candidate("job-terminalized"),
      candidate("job-raced"),
    ]);
    const failCandidate = mock(async (input: QueuedReceiptResidueCandidate) =>
      input.jobId === "job-terminalized",
    );

    const result = await runQueuedReceiptResidueSweepOnce(
      {
        minimumAgeMs: 300_000,
        batchSize: 25,
        now: () => new Date("2026-07-24T12:00:00.000Z"),
      },
      {
        findCandidates,
        failCandidate,
      },
    );

    expect(result).toEqual({
      selected: 2,
      terminalized: 1,
      raced: 1,
      errors: 0,
      terminalizedJobIds: ["job-terminalized"],
    });
    expect(findCandidates).toHaveBeenCalledWith({
      updatedBefore: new Date("2026-07-24T11:55:00.000Z"),
      limit: 25,
    });
  });

  test("does not start or schedule any work while durable receipts are enabled", () => {
    const scheduleTimeout = mock(() => ({ kind: "timeout" }));
    const scheduleInterval = mock(() => ({ kind: "interval" }));
    const runSweep = mock(async () => undefined);

    const stop = startQueuedReceiptResidueReconciler(
      {
        enabled: true,
        durableSequenceReceiptsEnabled: true,
        intervalMs: 60_000,
        minimumAgeMs: 300_000,
        batchSize: 25,
      },
      {
        runSweep,
        scheduleTimeout,
        clearScheduledTimeout: mock(() => undefined),
        scheduleInterval,
        clearScheduledInterval: mock(() => undefined),
      },
    );

    expect(scheduleTimeout).not.toHaveBeenCalled();
    expect(scheduleInterval).not.toHaveBeenCalled();
    expect(runSweep).not.toHaveBeenCalled();
    stop();
  });

  test("does not act when a direct sweep is invoked with the durable gate enabled", async () => {
    const findCandidates = mock(async () => [candidate("must-not-be-read")]);
    const failCandidate = mock(async () => true);

    expect(
      await runQueuedReceiptResidueSweepOnce(
        {
          durableSequenceReceiptsEnabled: true,
          minimumAgeMs: 300_000,
          batchSize: 25,
        },
        {
          findCandidates,
          failCandidate,
        },
      ),
    ).toEqual({
      selected: 0,
      terminalized: 0,
      raced: 0,
      errors: 0,
      terminalizedJobIds: [],
    });
    expect(findCandidates).not.toHaveBeenCalled();
    expect(failCandidate).not.toHaveBeenCalled();
  });

  test("also stays stopped when the operational rollback switch is disabled", () => {
    const scheduleTimeout = mock(() => ({ kind: "timeout" }));
    const scheduleInterval = mock(() => ({ kind: "interval" }));

    startQueuedReceiptResidueReconciler(
      {
        enabled: false,
        durableSequenceReceiptsEnabled: false,
        intervalMs: 60_000,
        minimumAgeMs: 300_000,
        batchSize: 25,
      },
      {
        runSweep: mock(async () => undefined),
        scheduleTimeout,
        clearScheduledTimeout: mock(() => undefined),
        scheduleInterval,
        clearScheduledInterval: mock(() => undefined),
      },
    );

    expect(scheduleTimeout).not.toHaveBeenCalled();
    expect(scheduleInterval).not.toHaveBeenCalled();
  });
});
