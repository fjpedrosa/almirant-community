import { describe, expect, it } from "bun:test";
import {
  createBridgeApiClient,
  createApiPersistenceStrategy,
  type BridgeApiClient,
  type NativeEventPayload,
  type SessionEventPayload,
} from "./persistence";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

describe("durable canonical persistence", () => {
  it("preflights the service-account credential before consuming events", async () => {
    const requests: Array<{ path: string; method: string; authorization: string | null }> = [];
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "alm_sa_test",
      log: () => undefined,
      fetch: async (url, init) => {
        requests.push({
          path: new URL(url).pathname,
          method: init?.method ?? "GET",
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({ success: true, data: { authenticated: true } });
      },
    });

    await client.checkCredential();

    expect(requests).toEqual([{
      path: "/workers/credential-check",
      method: "GET",
      authorization: "Bearer alm_sa_test",
    }]);
  });

  it("fails the credential preflight closed on a legacy user key", async () => {
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "alm_k1_legacy",
      log: () => undefined,
      fetch: async () => new Response("service account required", { status: 403 }),
    });

    await expect(client.checkCredential()).rejects.toMatchObject({
      retryable: false,
      status: 403,
    });
  });

  it("uses the durable insert result as the render decision", async () => {
    const insertResults = [{ inserted: 1 }, { inserted: 0 }];
    const apiClient = {
      updateJobStatus: async () => undefined,
      persistSessionEvents: async () => insertResults.shift()!,
      persistNativeEvents: async () => undefined,
    } as unknown as BridgeApiClient;
    const strategy = createApiPersistenceStrategy({
      apiClient,
      log: () => undefined,
      persistSessionEvents: true,
    });

    const context = {
      jobId: "job-redelivery",
      sequenceNumber: 7,
      sequenceProtocolVersion: "durable.v2" as const,
      claimAttemptId: "attempt-redelivery",
    };

    expect(
      await strategy.persistCanonicalEvent(
        { kind: "agent.text", content: "first delivery" },
        context,
      ),
    ).toBe(true);
    expect(
      await strategy.persistCanonicalEvent(
        { kind: "agent.text", content: "redelivery" },
        context,
      ),
    ).toBe(false);
  });

  it("returns the validated inserted count from the session-events API", async () => {
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "test",
      log: () => undefined,
      fetch: async () =>
        Response.json({ success: true, data: { inserted: 0 } }),
    });

    const result = await client.persistSessionEvents("job-duplicate", [
      {
        sequenceNum: 9,
        sequenceProtocolVersion: "durable.v2",
        claimAttemptId: "attempt-duplicate",
        kind: "agent.text",
        payload: { kind: "agent.text", content: "duplicate" },
      },
    ]);

    expect(result).toEqual({ inserted: 0 });
  });

  it("fails closed when the session-events API omits the insert result", async () => {
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "test",
      log: () => undefined,
      fetch: async () => Response.json({ success: true, data: {} }),
    });

    await expect(
      client.persistSessionEvents("job-malformed", [
        {
          sequenceNum: 1,
          sequenceProtocolVersion: "durable.v2",
          claimAttemptId: "attempt-malformed",
          kind: "agent.text",
          payload: { kind: "agent.text", content: "malformed" },
        },
      ]),
    ).rejects.toThrow("invalid session-events persistence response");
  });

  it("persists claim/protocol fencing metadata and leaves status ownership to the runner", async () => {
    const persisted: SessionEventPayload[] = [];
    let statusUpdates = 0;
    const apiClient: BridgeApiClient = {
      checkCredential: async () => undefined,
      updateJobStatus: async () => {
        statusUpdates += 1;
      },
      persistSessionEvents: async (_jobId, events) => {
        persisted.push(...events);
        return { inserted: events.length };
      },
      persistNativeEvents: async () => undefined,
    };
    const strategy = createApiPersistenceStrategy({
      apiClient,
      log: () => undefined,
      persistSessionEvents: true,
    });

    await strategy.persistCanonicalEvent(
      { kind: "job.completed", summary: "done" },
      {
        jobId: "job-1",
        sequenceNumber: 7,
        sequenceProtocolVersion: "durable.v2",
        claimAttemptId: "attempt-1",
      },
    );
    await strategy.flushJob("job-1");

    expect(statusUpdates).toBe(0);
    expect(persisted).toEqual([
      expect.objectContaining({
        sequenceNum: 7,
        sequenceProtocolVersion: "durable.v2",
        claimAttemptId: "attempt-1",
      }),
    ]);
  });

  it("does not resolve durable persistence until the API confirms the row", async () => {
    const gate = deferred<void>();
    let calls = 0;
    const apiClient: BridgeApiClient = {
      checkCredential: async () => undefined,
      updateJobStatus: async () => undefined,
      persistSessionEvents: async () => {
        calls += 1;
        await gate.promise;
        return { inserted: 1 };
      },
      persistNativeEvents: async () => undefined,
    };
    const strategy = createApiPersistenceStrategy({
      apiClient,
      log: () => undefined,
      persistSessionEvents: true,
    });

    let settled = false;
    const persistence = strategy.persistCanonicalEvent(
      { kind: "agent.text", content: "persist me" },
      {
        jobId: "job-pending",
        sequenceNumber: 1,
        sequenceProtocolVersion: "durable.v2",
        claimAttemptId: "attempt-pending",
      },
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(calls).toBe(1);
    expect(settled).toBe(false);

    gate.resolve();
    await persistence;
    expect(settled).toBe(true);
  });

  it("awaits durable native persistence instead of only enqueueing it", async () => {
    const gate = deferred<void>();
    const persisted: NativeEventPayload[] = [];
    const apiClient: BridgeApiClient = {
      checkCredential: async () => undefined,
      updateJobStatus: async () => undefined,
      persistSessionEvents: async () => ({ inserted: 0 }),
      persistNativeEvents: async (_jobId, events) => {
        persisted.push(...events);
        await gate.promise;
      },
    };
    const strategy = createApiPersistenceStrategy({
      apiClient,
      log: () => undefined,
      persistNativeEvents: true,
    });
    const event: NativeEventPayload = {
      sequenceNum: 2,
      sequenceProtocolVersion: "durable.v2",
      claimAttemptId: "attempt-native",
      nativeEventType: "message.part.updated",
      sourceFormat: "sse",
      payload: { type: "message.part.updated" },
    };

    let settled = false;
    const persistence = strategy.persistNativeEvent(event, {
      jobId: "job-native",
    }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(persisted).toEqual([event]);
    expect(settled).toBe(false);

    gate.resolve();
    await persistence;
    expect(settled).toBe(true);
  });

  it("retains a failed legacy batch and propagates the flush error", async () => {
    const persisted: SessionEventPayload[][] = [];
    let shouldFail = true;
    const apiClient: BridgeApiClient = {
      checkCredential: async () => undefined,
      updateJobStatus: async () => undefined,
      persistSessionEvents: async (_jobId, events) => {
        persisted.push(events);
        if (shouldFail) throw new Error("database unavailable");
        return { inserted: events.length };
      },
      persistNativeEvents: async () => undefined,
    };
    const strategy = createApiPersistenceStrategy({
      apiClient,
      log: () => undefined,
      persistSessionEvents: true,
    });
    await strategy.persistCanonicalEvent(
      { kind: "agent.text", content: "legacy" },
      { jobId: "legacy-job", sequenceNumber: 9 },
    );

    await expect(strategy.flushJob("legacy-job")).rejects.toThrow(
      "database unavailable",
    );
    shouldFail = false;
    await strategy.flushJob("legacy-job");

    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toEqual(persisted[0]);
  });

  it("retries network and retryable HTTP responses before succeeding", async () => {
    const responses: Array<Response | Error> = [
      new TypeError("network reset"),
      new Response("busy", { status: 503 }),
      Response.json({ success: true, data: { inserted: 1 } }),
    ];
    let calls = 0;
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "test",
      log: () => undefined,
      requestRetry: { maxRetries: 3, baseDelayMs: 0 },
      fetch: async () => {
        const next = responses[calls++];
        if (next instanceof Error) throw next;
        return next!;
      },
    });

    await client.persistSessionEvents("job-retry", [
      {
        sequenceNum: 1,
        sequenceProtocolVersion: "durable.v2",
        claimAttemptId: "attempt-retry",
        kind: "agent.text",
        payload: { kind: "agent.text", text: "retry" },
      },
    ]);

    expect(calls).toBe(3);
  });

  it("does not retry a non-retryable 409 response", async () => {
    let calls = 0;
    const client = createBridgeApiClient({
      baseUrl: "https://bridge.invalid",
      apiKey: "test",
      log: () => undefined,
      requestRetry: { maxRetries: 3, baseDelayMs: 0 },
      fetch: async () => {
        calls += 1;
        return new Response("claim mismatch", { status: 409 });
      },
    });

    await expect(
      client.persistSessionEvents("job-conflict", [
        {
          sequenceNum: 1,
          sequenceProtocolVersion: "durable.v2",
          claimAttemptId: "attempt-conflict",
          kind: "agent.text",
          payload: { kind: "agent.text", text: "conflict" },
        },
      ]),
    ).rejects.toMatchObject({ retryable: false, status: 409 });
    expect(calls).toBe(1);
  });
});
