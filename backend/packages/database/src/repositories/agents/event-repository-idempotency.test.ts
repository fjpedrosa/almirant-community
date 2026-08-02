import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NewAgentNativeEvent, NewSessionEvent } from "../../schema";
import type { CreateAgentJobLogInput } from "./agent-job-log-repository";

const realClient = { ...(await import("../../client")) };
const schema = await import("../../schema");

const nativeKeys = new Set<string>();
const logKeys = new Set<string>();
const durableSessionKeys = new Set<string>();
const insertedSessionRows: NewSessionEvent[] = [];

const keyFor = (jobId: string, sequence: number): string => `${jobId}:${sequence}`;

const insertUnique = <T>(
  rows: T[],
  keys: Set<string>,
  resolveKey: (row: T) => string,
): Array<T & { id: string }> => {
  const inserted: Array<T & { id: string }> = [];
  for (const row of rows) {
    const key = resolveKey(row);
    if (keys.has(key)) continue;
    keys.add(key);
    inserted.push({ ...row, id: `row-${key}` });
  }
  return inserted;
};

const dbMock = {
  insert: (table: unknown) => ({
    values: (rawRows: unknown[]) => {
      return {
        onConflictDoNothing: () => ({
          returning: async () => {
            if (table === schema.sessionEvents) {
              const rows = rawRows as NewSessionEvent[];
              const inserted: Array<NewSessionEvent & { id: string }> = [];
              for (const row of rows) {
                if (row.sequenceProtocolVersion === "durable.v2") {
                  const key = keyFor(row.agentJobId, row.sequenceNum);
                  if (durableSessionKeys.has(key)) continue;
                  durableSessionKeys.add(key);
                }
                insertedSessionRows.push(row);
                inserted.push({ ...row, id: `session-row-${insertedSessionRows.length}` });
              }
              return inserted;
            }

            if (table === schema.agentNativeEvents) {
              const rows = rawRows as NewAgentNativeEvent[];
              return insertUnique(
                rows,
                nativeKeys,
                (row) => keyFor(row.agentJobId, row.sequenceNum),
              );
            }

            const rows = rawRows as Array<{
              jobId: string;
              seq: number;
            }>;
            return insertUnique(
              rows,
              logKeys,
              (row) => keyFor(row.jobId, row.seq),
            );
          },
        }),
      };
    },
  }),
};

mock.module("../../client", () => ({ db: dbMock }));

afterAll(() => {
  mock.module("../../client", () => realClient);
  mock.restore();
});

beforeEach(() => {
  nativeKeys.clear();
  logKeys.clear();
  durableSessionKeys.clear();
  insertedSessionRows.length = 0;
});

describe("event repository redelivery idempotency", () => {
  it("preserves distinct legacy session events that share a job and sequence", async () => {
    const { insertSessionEventsBatch } = await import("./session-event-repository");
    const shared = {
      agentJobId: "00000000-0000-4000-8000-000000000001",
      sequenceNum: 7,
    };

    expect(await insertSessionEventsBatch([
      {
        ...shared,
        kind: "agent.text",
        payload: { marker: "first" },
      },
      {
        ...shared,
        kind: "tool.completed",
        payload: { marker: "second" },
      },
    ])).toBe(2);
    expect(insertedSessionRows.map((row) => row.kind)).toEqual([
      "agent.text",
      "tool.completed",
    ]);
  });

  it("suppresses only durable.v2 session-event redelivery", async () => {
    const { insertSessionEventsBatch } = await import("./session-event-repository");
    const event: NewSessionEvent = {
      agentJobId: "00000000-0000-4000-8000-000000000001",
      sequenceNum: 9,
      sequenceProtocolVersion: "durable.v2",
      kind: "system.info",
      payload: { marker: "exact-redelivery" },
    };

    expect(await insertSessionEventsBatch([event, event])).toBe(1);
    expect(await insertSessionEventsBatch([event])).toBe(0);
    expect(insertedSessionRows).toHaveLength(1);
  });

  it("reports only native rows actually inserted after exact redelivery", async () => {
    const { insertAgentNativeEventsBatch } = await import("./native-event-repository");
    const event: NewAgentNativeEvent = {
      agentJobId: "00000000-0000-4000-8000-000000000001",
      sequenceNum: 9,
      nativeEventType: "runtime.notice",
      sourceFormat: "sse",
      payload: { marker: "safe-test-value" },
    };

    expect(await insertAgentNativeEventsBatch([event])).toBe(1);
    expect(await insertAgentNativeEventsBatch([event])).toBe(0);
    expect(nativeKeys.size).toBe(1);
  });

  it("returns no duplicate log rows for an exact job/sequence redelivery", async () => {
    const { createAgentJobLogBatch } = await import("./agent-job-log-repository");
    const entry: CreateAgentJobLogInput = {
      jobId: "00000000-0000-4000-8000-000000000001",
      orgId: "00000000-0000-4000-8000-000000000002",
      seq: 11,
      level: "info",
      phase: "session",
      eventType: "session.notice",
      message: "safe-test-value",
      timestamp: new Date("2026-07-13T00:00:00.000Z"),
    };

    expect(await createAgentJobLogBatch([entry])).toHaveLength(1);
    expect(await createAgentJobLogBatch([entry])).toHaveLength(0);
    expect(logKeys.size).toBe(1);
  });
});
