import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NewAgentNativeEvent, NewSessionEvent } from "../../schema";
import type { CreateAgentJobLogInput } from "./agent-job-log-repository";

const realClient = { ...(await import("../../client")) };
const schema = await import("../../schema");

const nativeKeys = new Set<string>();
const logKeys = new Set<string>();
const durableSessionKeys = new Set<string>();
const insertedSessionRows: NewSessionEvent[] = [];
const insertedNativeRows: Array<NewAgentNativeEvent & { id: string }> = [];
let nativeInsertCalls = 0;

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
  insert: (table: unknown) => {
    if (table === schema.agentNativeEvents) nativeInsertCalls += 1;
    return {
      values: (rawRows: unknown[]) => ({
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
                inserted.push({
                  ...row,
                  id: `session-row-${insertedSessionRows.length}`,
                });
              }
              return inserted;
            }

            if (table === schema.agentNativeEvents) {
              const rows = rawRows as NewAgentNativeEvent[];
              const inserted = insertUnique(
                rows,
                nativeKeys,
                (row) => keyFor(row.agentJobId, row.sequenceNum),
              );
              insertedNativeRows.push(...inserted);
              return inserted;
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
      }),
    };
  },
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        orderBy: () => ({
          limit: async () =>
            table === schema.agentNativeEvents
              ? insertedNativeRows.map((row) => ({ ...row }))
              : [],
        }),
      }),
    }),
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
  insertedNativeRows.length = 0;
  nativeInsertCalls = 0;
});

const nativeEventFixture = (
  overrides: Partial<NewAgentNativeEvent> = {},
): NewAgentNativeEvent => ({
  agentJobId: "00000000-0000-4000-8000-000000000001",
  sequenceNum: 9,
  nativeEventType: "runtime.notice",
  sourceFormat: "sse",
  provider: "zipu",
  codingAgent: "pi",
  aiProvider: "zai",
  model: "glm-5.3",
  payload: { marker: "safe-test-value" },
  ...overrides,
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

  it("round-trips the separated Pi runtime tuple and dedupes exact native redelivery", async () => {
    const {
      getAgentNativeEventsByJobId,
      insertAgentNativeEventsBatch,
    } = await import("./native-event-repository");
    const event = nativeEventFixture();

    expect(await insertAgentNativeEventsBatch([event])).toBe(1);
    expect(await insertAgentNativeEventsBatch([event])).toBe(0);
    expect(nativeKeys.size).toBe(1);

    const [persisted] = await getAgentNativeEventsByJobId(event.agentJobId);
    expect(persisted).toMatchObject({
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      payload: { marker: "safe-test-value" },
    });
    expect(persisted?.payload).toEqual(event.payload);
  });

  it("re-sanitizes nested native diagnostics without persisting fake credential fragments", async () => {
    const { insertAgentNativeEventsBatch } = await import("./native-event-repository");
    const fakeApiKey = "sk-FAKE_REPOSITORY_SECRET_PREFIX_123456_SUFFIX";
    const fakeBearer = "Bearer FAKE_REPOSITORY_BEARER_PREFIX_123456_SUFFIX";
    const event = nativeEventFixture({
      payload: {
        marker: "normal-payload-remains-exact",
        nested: {
          command: "printf FAKE_REPOSITORY_COMMAND_PREFIX_123456_SUFFIX",
          config: {
            endpoint: "https://user:pass@example.test/path?token=FAKE_URL_SUFFIX",
          },
          headers: { authorization: fakeBearer },
          urls: ["https://example.test/FAKE_REPOSITORY_URL_PREFIX/path"],
          env: { API_KEY: fakeApiKey },
          logs: ["FAKE_REPOSITORY_LOG_PREFIX_123456_SUFFIX"],
        },
        note: `credentials ${fakeApiKey} and ${fakeBearer}`,
      },
    });

    expect(await insertAgentNativeEventsBatch([event])).toBe(1);
    expect(await insertAgentNativeEventsBatch([event])).toBe(0);
    expect(insertedNativeRows).toHaveLength(1);
    expect(insertedNativeRows[0]?.payload).toMatchObject({
      marker: "normal-payload-remains-exact",
    });
    const persisted = JSON.stringify(insertedNativeRows[0]);
    expect(persisted).not.toContain(fakeApiKey);
    expect(persisted).not.toContain(fakeBearer);
    expect(persisted).not.toContain("FAKE_REPOSITORY_SECRET_PREFIX");
    expect(persisted).not.toContain("123456_SUFFIX");
    expect(persisted).not.toContain("FAKE_REPOSITORY_COMMAND_PREFIX");
    expect(persisted).not.toContain("FAKE_REPOSITORY_URL_PREFIX");
    expect(persisted).not.toContain("FAKE_REPOSITORY_LOG_PREFIX");
    expect(persisted).not.toContain("user:pass");
  });

  it("rejects unsafe payload shapes and bounds before calling the database", async () => {
    const { insertAgentNativeEventsBatch } = await import("./native-event-repository");
    const cyclic: Record<string, unknown> = {
      token: "sk-FAKE_ERROR_SECRET_PREFIX_123456_SUFFIX",
    };
    cyclic.self = cyclic;
    let getterCalled = false;
    const accessor = Object.defineProperty({}, "token", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return "sk-FAKE_GETTER_SECRET_PREFIX_123456_SUFFIX";
      },
    });
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index <= 8; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const cases: Array<[unknown, string]> = [
      [cyclic, "RUNTIME_DIAGNOSTIC_CYCLE"],
      [accessor, "RUNTIME_DIAGNOSTIC_MALFORMED"],
      [deep, "RUNTIME_DIAGNOSTIC_TOO_DEEP"],
      [
        Array.from({ length: 64 }, () =>
          Array.from({ length: 8 }, () => null)),
        "RUNTIME_DIAGNOSTIC_TOO_MANY_NODES",
      ],
      [Array.from({ length: 65 }, () => null), "RUNTIME_DIAGNOSTIC_ARRAY_TOO_LARGE"],
      ["x".repeat(8_193), "RUNTIME_DIAGNOSTIC_STRING_TOO_LARGE"],
      [
        Array.from({ length: 5 }, () => "é".repeat(4_000)),
        "RUNTIME_DIAGNOSTIC_ENCODED_TOO_LARGE",
      ],
      [new Date(0), "RUNTIME_DIAGNOSTIC_NON_PLAIN_OBJECT"],
    ];

    for (const [payload, code] of cases) {
      try {
        await insertAgentNativeEventsBatch([
          nativeEventFixture({ payload: payload as Record<string, unknown> }),
        ]);
        throw new Error("expected native event payload rejection");
      } catch (error) {
        expect(error).toMatchObject({ code });
        expect(String(error)).not.toContain("FAKE_ERROR_SECRET_PREFIX");
        expect(String(error)).not.toContain("123456_SUFFIX");
      }
    }
    expect(getterCalled).toBe(false);
    expect(nativeInsertCalls).toBe(0);
    expect(insertedNativeRows).toEqual([]);
  });

  it("rejects unsafe metadata, tuples, and oversized batches before database insertion", async () => {
    const {
      AGENT_NATIVE_EVENT_LIMITS,
      AgentNativeEventValidationError,
      insertAgentNativeEventsBatch,
    } = await import("./native-event-repository");
    const invalidEvents = [
      nativeEventFixture({ nativeEventType: "x".repeat(121) }),
      nativeEventFixture({ sourceFormat: "x".repeat(51) }),
      nativeEventFixture({ runtimeSessionId: "x".repeat(256) }),
      nativeEventFixture({ model: "x".repeat(257) }),
      nativeEventFixture({ provider: "zai" as NewAgentNativeEvent["provider"] }),
      nativeEventFixture({ codingAgent: "unknown" as NewAgentNativeEvent["codingAgent"] }),
      nativeEventFixture({ aiProvider: "unknown" as NewAgentNativeEvent["aiProvider"] }),
      nativeEventFixture({ model: "glm-other" }),
      nativeEventFixture({ sequenceNum: 9.5 }),
    ];

    for (const event of invalidEvents) {
      await expect(insertAgentNativeEventsBatch([event])).rejects.toBeInstanceOf(
        AgentNativeEventValidationError,
      );
    }
    await expect(insertAgentNativeEventsBatch(Array.from(
      { length: AGENT_NATIVE_EVENT_LIMITS.maxBatchSize + 1 },
      (_, sequenceNum) => nativeEventFixture({ sequenceNum }),
    ))).rejects.toMatchObject({ code: "NATIVE_EVENT_BATCH_TOO_LARGE" });

    expect(nativeInsertCalls).toBe(0);
    expect(insertedNativeRows).toEqual([]);
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
