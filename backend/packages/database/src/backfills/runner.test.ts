import { describe, expect, test } from "bun:test";
import {
  DataBackfillError,
  runDataBackfills,
  type DataBackfillDefinition,
  type DataBackfillLedger,
  type DataBackfillRecord,
} from "./runner";

const createMemoryLedger = (
  initial: DataBackfillRecord[] = [],
): DataBackfillLedger & { records: Map<string, DataBackfillRecord>; lockCount: number } => {
  const records = new Map(initial.map((record) => [record.key, { ...record }]));
  return {
    records,
    lockCount: 0,
    async withGlobalLock(run) {
      this.lockCount += 1;
      return run();
    },
    async get(key) {
      return records.get(key) ?? null;
    },
    async markRunning(definition, now) {
      const previous = records.get(definition.key);
      const record: DataBackfillRecord = {
        key: definition.key,
        description: definition.description,
        checksum: definition.checksum,
        status: "running",
        attemptCount: (previous?.attemptCount ?? 0) + 1,
        processedCount: previous?.processedCount ?? null,
        metadata: previous?.metadata ?? {},
        errorMessage: null,
        startedAt: now,
        completedAt: null,
      };
      records.set(definition.key, record);
      return record;
    },
    async markSucceeded(key, result, now) {
      const previous = records.get(key);
      if (!previous) throw new Error(`missing running record for ${key}`);
      records.set(key, {
        ...previous,
        status: "succeeded",
        processedCount: result.processedCount ?? null,
        metadata: result.metadata ?? {},
        errorMessage: null,
        completedAt: now,
      });
    },
    async markFailed(key, error, now) {
      const previous = records.get(key);
      if (!previous) throw new Error(`missing running record for ${key}`);
      records.set(key, {
        ...previous,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: now,
      });
    },
  };
};

const createBackfill = (
  overrides: Partial<DataBackfillDefinition> = {},
): DataBackfillDefinition => ({
  key: "test/backfill",
  description: "Test backfill",
  checksum: "checksum-v1",
  fatalOnFailure: true,
  run: async () => ({ processedCount: 3, metadata: { ok: true } }),
  ...overrides,
});

describe("runDataBackfills", () => {
  test("runs pending backfills under a global lock and records success", async () => {
    const ledger = createMemoryLedger();
    let calls = 0;

    const results = await runDataBackfills(
      [createBackfill({ run: async () => {
        calls += 1;
        return { processedCount: 7, metadata: { touched: "jobs" } };
      } })],
      ledger,
      { now: () => new Date("2026-04-30T10:00:00.000Z") },
    );

    expect(calls).toBe(1);
    expect(ledger.lockCount).toBe(1);
    expect(results).toEqual([
      {
        key: "test/backfill",
        status: "succeeded",
        processedCount: 7,
        metadata: { touched: "jobs" },
      },
    ]);
    expect(ledger.records.get("test/backfill")).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
      processedCount: 7,
      metadata: { touched: "jobs" },
      completedAt: new Date("2026-04-30T10:00:00.000Z"),
    });
  });

  test("skips already succeeded backfills with the same checksum", async () => {
    const ledger = createMemoryLedger([
      {
        key: "test/backfill",
        description: "Test backfill",
        checksum: "checksum-v1",
        status: "succeeded",
        attemptCount: 1,
        processedCount: 11,
        metadata: { previous: true },
        errorMessage: null,
        startedAt: new Date("2026-04-30T09:00:00.000Z"),
        completedAt: new Date("2026-04-30T09:01:00.000Z"),
      },
    ]);
    let calls = 0;

    const results = await runDataBackfills([
      createBackfill({ run: async () => {
        calls += 1;
        return { processedCount: 1 };
      } }),
    ], ledger);

    expect(calls).toBe(0);
    expect(results).toEqual([
      {
        key: "test/backfill",
        status: "skipped",
        processedCount: 11,
        metadata: { previous: true },
      },
    ]);
    expect(ledger.records.get("test/backfill")?.attemptCount).toBe(1);
  });

  test("reruns succeeded backfills when checksum changes", async () => {
    const ledger = createMemoryLedger([
      {
        key: "test/backfill",
        description: "Test backfill",
        checksum: "checksum-v1",
        status: "succeeded",
        attemptCount: 2,
        processedCount: 4,
        metadata: {},
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      },
    ]);

    await runDataBackfills([
      createBackfill({ checksum: "checksum-v2" }),
    ], ledger);

    expect(ledger.records.get("test/backfill")).toMatchObject({
      checksum: "checksum-v2",
      status: "succeeded",
      attemptCount: 3,
    });
  });

  test("records non-fatal failures and continues to later backfills", async () => {
    const ledger = createMemoryLedger();
    const secondCalls: string[] = [];

    const results = await runDataBackfills([
      createBackfill({
        key: "one",
        fatalOnFailure: false,
        run: async () => {
          throw new Error("boom");
        },
      }),
      createBackfill({
        key: "two",
        run: async () => {
          secondCalls.push("ran");
          return { processedCount: 1 };
        },
      }),
    ], ledger);

    expect(secondCalls).toEqual(["ran"]);
    expect(results.map((result) => result.status)).toEqual(["failed", "succeeded"]);
    expect(ledger.records.get("one")).toMatchObject({
      status: "failed",
      errorMessage: "boom",
    });
  });

  test("throws DataBackfillError for fatal failures after recording them", async () => {
    const ledger = createMemoryLedger();

    await expect(runDataBackfills([
      createBackfill({
        key: "fatal",
        fatalOnFailure: true,
        run: async () => {
          throw new Error("fatal boom");
        },
      }),
    ], ledger)).rejects.toBeInstanceOf(DataBackfillError);

    expect(ledger.records.get("fatal")).toMatchObject({
      status: "failed",
      errorMessage: "fatal boom",
    });
  });
});
