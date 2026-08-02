import { describe, expect, it } from "bun:test";
import type {
  AlmirantWorkerClient,
  OpenCodeSessionManager,
} from "@almirant/remote-agent";
import type {
  CanonicalEventEnvelope,
  NativeEventEnvelope,
  StreamPublisher,
} from "@almirant/stream-consumer";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import { consumeSseEvents } from "./event-consumer";
import { createJobSecretRedactor } from "../security/job-secret-redactor";
import { runtimeEventFixtures } from "../../test/fixtures/runtime-event-contract-fixtures";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createWorkerClient = (): AlmirantWorkerClient =>
  ({
    getJobStatus: async () => ({ status: "running" }),
    createInteraction: async () => ({ id: "interaction-1", questionType: "free_text" }),
    pollInteraction: async () => ({ status: "answered", response: "ok" }),
    streamJobOutput: async () => ({ processed: 0, stepIndex: 0 }),
  }) as unknown as AlmirantWorkerClient;

const createBlockingSessionManager = (): OpenCodeSessionManager =>
  ({
    async *streamSessionEvents(_sessionId?: string, signal?: AbortSignal) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    async sendPromptAsync() {
      return;
    },
  }) as unknown as OpenCodeSessionManager;

const createSessionManager = (
  events: Array<{ event?: string; data: string }>,
): OpenCodeSessionManager =>
  ({
    async *streamSessionEvents() {
      for (const event of events) {
        yield event;
      }
    },
    async sendPromptAsync() {
      return;
    },
  }) as unknown as OpenCodeSessionManager;

const createEventLogger = (): RunnerJobEventLogger =>
  ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    transcript: () => undefined,
  }) as unknown as RunnerJobEventLogger;

const createStreamPublisher = (published: unknown[]): StreamPublisher =>
  ({
    publish: async (event: unknown) => {
      published.push(event);
      return "stream-1";
    },
    publishCanonicalEnvelope: async (envelope: CanonicalEventEnvelope) => {
      published.push({
        ...envelope,
        _format: "canonical",
        event: JSON.stringify(envelope.event),
      });
      return "canonical-1";
    },
    publishNativeEnvelope: async (envelope: NativeEventEnvelope) => {
      published.push({
        ...envelope,
        _format: "native",
      });
      return "native-1";
    },
    close: async () => {
      return;
    },
  }) as unknown as StreamPublisher;

describe("consumeSseEvents", () => {
  for (const fixture of runtimeEventFixtures) {
    it(`publica el flujo canónico completo para ${fixture.runtime}`, async () => {
      const published: unknown[] = [];
      const result = await consumeSseEvents(
        {
          workerClient: createWorkerClient(),
          containerManager: {} as never,
          config: {},
        },
        {
          sessionManager: createSessionManager(fixture.sseEvents),
          sessionId: `${fixture.runtime}-session`,
          jobId: `${fixture.runtime}-job`,
          isPlanningJob: false,
          eventLogger: createEventLogger(),
          redactor: createJobSecretRedactor(),
          streamPublisher: createStreamPublisher(published),
          threadId: `thread-${fixture.runtime}`,
          webSessionId: `web-${fixture.runtime}`,
          webWorkspaceId: "org-1",
        },
      );

      const publishedObjects = published
        .filter((event): event is Record<string, unknown> => {
          return typeof event === "object" && event !== null;
        });
      const canonicalEvents = publishedObjects
        .filter((event) => event._format === "canonical")
        .map((event) => JSON.parse(String(event.event)) as Record<string, unknown>);
      const nativeEvents = publishedObjects
        .filter((event) => event._format === "native");

      expect(result.success).toBe(true);
      expect(nativeEvents.length).toBeGreaterThanOrEqual(fixture.sseEvents.length);
      expect(result.summary).toBe(fixture.expectedSummary);
      expect(canonicalEvents).toHaveLength(fixture.expectedCanonicalEvents.length);
      fixture.expectedCanonicalEvents.forEach((expectedEvent, index) => {
        expect(canonicalEvents[index]).toMatchObject(expectedEvent);
      });
    });
  }

  it("detiene la sesión y conserva pending failed sin convertirlo en cancelación", async () => {
    const result = await consumeSseEvents(
      {
        workerClient: {
          ...createWorkerClient(),
          getJobStatus: async () => ({
            status: "failed",
            errorType: "interaction-timeout",
            errorMessage: "Interaction timed out",
          }),
        } as AlmirantWorkerClient,
        containerManager: {} as never,
        config: {
          overallTimeoutMs: 100,
          jobStatusPollIntervalMs: 1,
        },
      },
      {
        sessionManager: createBlockingSessionManager(),
        sessionId: "failed-session",
        jobId: "failed-job",
        isPlanningJob: false,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
      },
    );

    expect(result.success).toBe(false);
    expect(result.cancelledByUser).toBe(false);
    expect(result.terminalIntent).toEqual({
      status: "failed",
      shutdownRequested: false,
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out",
    });
  });

  it("espera el status poll en vuelo cuando el SSE termina y conserva pending failed", async () => {
    const statusRequested = deferred<void>();
    const statusResponse = deferred<{
      status: "failed";
      errorType: string;
      errorMessage: string;
    }>();
    const streamFinished = deferred<void>();
    const finishLogCodes: string[] = [];
    let resultSettled = false;

    const sessionManager = {
      async *streamSessionEvents() {
        await statusRequested.promise;
        streamFinished.resolve();
      },
      async sendPromptAsync() {
        return;
      },
    } as unknown as OpenCodeSessionManager;

    const eventLogger = {
      ...createEventLogger(),
      info: (phase: string, code: string) => {
        if (phase === "finish") finishLogCodes.push(code);
      },
    } as unknown as RunnerJobEventLogger;

    const resultPromise = consumeSseEvents(
      {
        workerClient: {
          ...createWorkerClient(),
          getJobStatus: async () => {
            statusRequested.resolve();
            return statusResponse.promise;
          },
        } as AlmirantWorkerClient,
        containerManager: {} as never,
        config: {
          overallTimeoutMs: 1_000,
          jobStatusPollIntervalMs: 1,
        },
      },
      {
        sessionManager,
        sessionId: "late-failed-session",
        jobId: "late-failed-job",
        isPlanningJob: false,
        eventLogger,
        redactor: createJobSecretRedactor(),
      },
    ).finally(() => {
      resultSettled = true;
    });

    await streamFinished.promise;
    await Promise.resolve();
    expect(resultSettled).toBe(false);

    statusResponse.resolve({
      status: "failed",
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out after SSE closed",
    });

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.cancelledByUser).toBe(false);
    expect(result.terminalIntent).toEqual({
      status: "failed",
      shutdownRequested: false,
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out after SSE closed",
    });
    expect(finishLogCodes).toContain("job.failed");
    expect(finishLogCodes).not.toContain("job.completed");
  });

  it("acota el join de un status poll colgado para no bloquear el cleanup", async () => {
    const statusRequested = deferred<void>();
    const neverResponds = deferred<never>();
    const finishLogCodes: string[] = [];

    const sessionManager = {
      async *streamSessionEvents() {
        await statusRequested.promise;
      },
      async sendPromptAsync() {
        return;
      },
    } as unknown as OpenCodeSessionManager;

    const eventLogger = {
      ...createEventLogger(),
      info: (phase: string, code: string) => {
        if (phase === "finish") finishLogCodes.push(code);
      },
      warn: (phase: string, code: string) => {
        if (phase === "finish") finishLogCodes.push(code);
      },
    } as unknown as RunnerJobEventLogger;

    const result = await Promise.race([
      consumeSseEvents(
        {
          workerClient: {
            ...createWorkerClient(),
            getJobStatus: async () => {
              statusRequested.resolve();
              return neverResponds.promise;
            },
          } as AlmirantWorkerClient,
          containerManager: {} as never,
          config: {
            overallTimeoutMs: 1_000,
            jobStatusPollIntervalMs: 1,
            jobStatusPollJoinTimeoutMs: 5,
          },
        },
        {
          sessionManager,
          sessionId: "hung-status-session",
          jobId: "hung-status-job",
          isPlanningJob: false,
          eventLogger,
          redactor: createJobSecretRedactor(),
        },
      ),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("status poll cleanup deadlocked")), 100);
      }),
    ]);

    expect(result.success).toBe(false);
    expect(result.terminalIntent).toBeUndefined();
    expect(result.terminalStatusIndeterminate).toBe(true);
    expect(result.errorMessage).toBe(
      "Terminal status poll did not settle before cleanup deadline",
    );
    expect(finishLogCodes).toContain("job.terminal_status_indeterminate");
    expect(finishLogCodes).not.toContain("job.completed");
    expect(finishLogCodes).not.toContain("job.failed");
    expect(finishLogCodes).not.toContain("job.cancelled");
  });

  it("propaga isPlanningJob en session.idle y emite texto final para planning sin web output", async () => {
    const streamed: Array<{ content: string }> = [];
    const published: unknown[] = [];

    const result = await consumeSseEvents(
      {
        workerClient: {
          ...createWorkerClient(),
          streamJobOutput: async (_jobId, payload) => {
            streamed.push(payload as { content: string });
            return { processed: 1, stepIndex: payload.stepIndex ?? 0 };
          },
        } as AlmirantWorkerClient,
        containerManager: {} as never,
        config: {
          webOutputEnabled: false,
        },
      },
      {
        sessionManager: createSessionManager([
          {
            data: JSON.stringify({
              type: "message.part.delta",
              properties: {
                contentType: "text",
                delta: "Plan listo",
              },
            }),
          },
          {
            data: JSON.stringify({
              type: "session.idle",
              properties: {},
            }),
          },
        ]),
        sessionId: "planning-session",
        jobId: "planning-job",
        isPlanningJob: true,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
        streamPublisher: createStreamPublisher(published),
        threadId: "thread-planning",
        webSessionId: "web-planning",
        webWorkspaceId: "org-1",
      },
    );

    const idleEvent = published
      .filter((event): event is Record<string, unknown> => typeof event === "object" && event !== null)
      .filter((event) => event._format === "canonical")
      .map((event) => JSON.parse(String(event.event)) as Record<string, unknown>)
      .find((event) => event.kind === "session.idle");

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Plan listo");
    expect(idleEvent).toMatchObject({
      kind: "session.idle",
      isPlanningJob: true,
    });
    expect(streamed).toHaveLength(1);
    expect(streamed[0]).toMatchObject({
      content: "Planning turn completed\n",
      contentType: "text",
      persistContent: true,
      stepIndex: 0,
    });
  });

  it("devuelve errorMessage cuando el stream aborta por session.error fatal", async () => {
    const result = await consumeSseEvents(
      {
        workerClient: createWorkerClient(),
        containerManager: {} as never,
        config: {},
      },
      {
        sessionManager: createSessionManager([
          {
            data: JSON.stringify({
              type: "message.part.delta",
              properties: {
                contentType: "text",
                delta: "Antes del error",
              },
            }),
          },
          {
            data: JSON.stringify({
              type: "session.error",
              properties: {
                message: "provider exploded",
              },
            }),
          },
        ]),
        sessionId: "error-session",
        jobId: "error-job",
        isPlanningJob: false,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
      },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("provider exploded");
    expect(result.summary).toBeUndefined();
  });

  it("pausa la sesión cuando detecta un límite de subscripción en el stream", async () => {
    const result = await consumeSseEvents(
      {
        workerClient: createWorkerClient(),
        containerManager: {} as never,
        config: {},
      },
      {
        sessionManager: createSessionManager([
          {
            data: JSON.stringify({
              type: "message.part.delta",
              properties: {
                contentType: "text",
                delta: "You've hit your limit. Resets in 1m.",
              },
            }),
          },
          {
            data: JSON.stringify({
              type: "session.idle",
              properties: {},
            }),
          },
        ]),
        sessionId: "quota-session",
        jobId: "quota-job",
        isPlanningJob: false,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
      },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("Session hit subscription rate limit");
    expect(result.pausedForQuota).toMatchObject({
      reason: "Session hit subscription rate limit",
      errorType: "subscription_limit",
      retryDelayMs: 60_000,
      sourceEventType: "message.part.delta",
    });
    expect(typeof result.pausedForQuota?.availableAt).toBe("string");
  });

  it("no pausa la sesión cuando una salida de herramienta contiene texto sobre límites", async () => {
    const result = await consumeSseEvents(
      {
        workerClient: createWorkerClient(),
        containerManager: {} as never,
        config: {},
      },
      {
        sessionManager: createSessionManager([
          {
            data: JSON.stringify({
              type: "message.part.updated",
              properties: {
                part: {
                  type: "tool",
                  tool: "read",
                  state: {
                    status: "completed",
                    output: "Documentation mentions usage limit handling but this is just file content.",
                  },
                },
              },
            }),
          },
          {
            data: JSON.stringify({
              type: "message.part.delta",
              properties: {
                contentType: "text",
                delta: "Continuing normally",
              },
            }),
          },
          {
            data: JSON.stringify({
              type: "session.idle",
              properties: {},
            }),
          },
        ]),
        sessionId: "tool-output-session",
        jobId: "tool-output-job",
        isPlanningJob: false,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
      },
    );

    expect(result.success).toBe(true);
    expect(result.pausedForQuota).toBeUndefined();
    expect(result.summary).toBe("Continuing normally");
  });

  it("falla la sesión cuando el runtime emite session.status con status error", async () => {
    const result = await consumeSseEvents(
      {
        workerClient: createWorkerClient(),
        containerManager: {} as never,
        config: {},
      },
      {
        sessionManager: createSessionManager([
          {
            data: JSON.stringify({
              type: "session.status",
              properties: {
                status: "error",
                message: "The 'gpt-5.5' model requires a newer version of Codex.",
              },
            }),
          },
          {
            data: JSON.stringify({
              type: "session.idle",
              properties: {},
            }),
          },
        ]),
        sessionId: "status-error-session",
        jobId: "status-error-job",
        isPlanningJob: false,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
      },
    );

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("The 'gpt-5.5' model requires a newer version of Codex.");
    expect(result.summary).toBeUndefined();
  });
});
