import { describe, expect, it } from "bun:test";
import type {
  AlmirantWorkerClient,
  ClaimedJob,
  OpenCodeSessionManager,
} from "@almirant/remote-agent";
import type {
  CanonicalEventEnvelope,
  NativeEventEnvelope,
  StreamPublisher,
} from "@almirant/stream-consumer";
import {
  buildJobRuntimeEvidence,
  buildUsagePayloadFields,
} from "../src/job-executor";
import { consumeSseEvents } from "../src/session/event-consumer";
import type { RunnerJobEventLogger } from "../src/observability/job-event-logger";
import { createJobSecretRedactor } from "../src/security/job-secret-redactor";
import {
  createPiMappingContext,
  finalizePiTurn,
  mapPiEventToShim,
  type PiUsageSnapshot,
} from "../docker/pi-shim/src/event-mapper";

const usageReplayPath = `${import.meta.dir}/fixtures/pi-0.84.2/rpc-usage-replay-v1.jsonl`;

const usageReplayRecords = async (): Promise<Record<string, unknown>[]> =>
  (await Bun.file(usageReplayPath).text())
    .trimEnd()
    .split("\n")
    .map((line) =>
      (JSON.parse(line) as { record: Record<string, unknown> }).record
    );

const createWorkerClient = (): AlmirantWorkerClient =>
  ({
    getJobStatus: async () => ({ status: "running" }),
    streamJobOutput: async () => ({ processed: 0, stepIndex: 0 }),
  }) as unknown as AlmirantWorkerClient;

const createEventLogger = (): RunnerJobEventLogger =>
  ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    transcript: () => undefined,
  }) as unknown as RunnerJobEventLogger;

const createSessionManager = (
  events: Array<{ event?: string; data: string }>,
): OpenCodeSessionManager =>
  ({
    async *streamSessionEvents() {
      for (const event of events) yield event;
    },
    async sendPromptAsync() {
      return;
    },
  }) as unknown as OpenCodeSessionManager;

const createStreamPublisher = (
  native: NativeEventEnvelope[],
): StreamPublisher =>
  ({
    publish: async () => "legacy-1",
    publishCanonicalEnvelope: async (_envelope: CanonicalEventEnvelope) =>
      "canonical-1",
    publishNativeEnvelope: async (envelope: NativeEventEnvelope) => {
      native.push(envelope);
      return "native-1";
    },
    close: async () => undefined,
  }) as StreamPublisher;

const piJob = (): ClaimedJob =>
  ({
    id: "job-pi-evidence",
    provider: "zipu",
    codingAgent: "pi",
    aiProvider: "zai",
    model: "glm-5.3-requested",
    resolvedRuntimeSelection: {
      schemaVersion: "resolved-runtime-selection-v1",
      registryVersion: 1,
      projectionHash: "sha256:fixture",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      authClass: "api_key",
      capabilities: [],
      provenance: {
        provider: "explicit",
        codingAgent: "explicit",
        aiProvider: "explicit",
        model: "explicit",
        authClass: "explicit",
        capabilities: "explicit",
      },
    },
    config: {},
  }) as unknown as ClaimedJob;

const buildPiTerminalEvent = async (
  sessionStatsDelta?: PiUsageSnapshot,
): Promise<Record<string, unknown>> => {
  const context = createPiMappingContext();
  for (const event of await usageReplayRecords()) {
    if (event.type === "message_end") {
      mapPiEventToShim("pi-runtime-session", event, context);
    }
  }
  const terminal = finalizePiTurn("pi-runtime-session", context, {
    sessionStatsDelta,
    observedSelection: {
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      reasoningLevel: "high",
    },
  });
  const idle = terminal.canonicalEvents.find((event) => event.kind === "session.idle");
  if (!idle) throw new Error("fixture did not produce session.idle");
  return idle;
};

describe("Pi runtime evidence persistence transport", () => {
  it("replays the fixture losslessly, deduplicates terminal evidence, and separates every selection lane", async () => {
    const idle = await buildPiTerminalEvent({
      input: 20,
      output: 8,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 30,
    });
    const native: NativeEventEnvelope[] = [];
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
              type: "native.event",
              properties: {
                nativeEventType: "message_end",
                sourceFormat: "pi-rpc",
                codingAgent: "pi",
                aiProvider: "zai",
                model: "glm-5.3",
                runtimeSessionId: "pi-runtime-session",
                payload: { type: "message_end" },
              },
            }),
          },
          { data: JSON.stringify({ type: "session.idle", properties: idle }) },
          { data: JSON.stringify({ type: "session.idle", properties: idle }) },
        ]),
        sessionId: "runner-session",
        jobId: "job-pi-evidence",
        isPlanningJob: false,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
        streamPublisher: createStreamPublisher(native),
        infrastructureProvider: "zipu",
      },
    );

    const expectedUsageIdentities = [
      "rti_sha256_18159a6aac19e255fa5e532445acf3f822884ea6faa808fe157d74abd8a1b13f",
      "rti_sha256_3c5a8f921fb5ac5aded7a031fddedc1997f44f052e9368db1b1f6b5a0dea9a94",
    ];
    expect(result.runtimeEvidence?.usage).toEqual({
      status: "reported",
      source: "terminal_aggregate",
      identities: expectedUsageIdentities.map((messageId) => ({ messageId })),
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      reasoningTokens: 3,
      totalTokens: 30,
      cost: {
        totalUsd: 3,
        detail: { input: 1.25, output: 1.75, total: 3 },
      },
    });

    const reportedUsage = result.runtimeEvidence?.usage;
    if (reportedUsage?.status !== "reported") {
      throw new Error("expected reported Pi usage evidence");
    }
    const messageIdentities = (reportedUsage.identities ?? []).map(
      (identity) => identity.messageId,
    );
    expect(messageIdentities).toEqual(expectedUsageIdentities);
    expect(messageIdentities.every(
      (identity) =>
        typeof identity === "string" &&
        /^rti_sha256_[a-f0-9]{64}$/u.test(identity),
    )).toBe(true);
    expect(new Set(messageIdentities).size).toBe(messageIdentities.length);

    const serializedUsage = JSON.stringify(reportedUsage);
    for (const rawIdentitySource of [
      "raw-prefix-sk-FAKE_REPLAY_IDENTITY_SENTINEL_123456-raw-suffix",
      "Bearer FAKE_REPLAY_BEARER_IDENTITY_SENTINEL_123456",
      "timestamp:assistant:1000",
      "timestamp:assistant:1001",
      "1000",
      "1001",
    ]) {
      expect(serializedUsage).not.toContain(rawIdentitySource);
    }
    expect(result).toMatchObject({
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      reasoningTokens: 3,
      tokensUsed: 30,
      costUsd: 3,
      costDetail: { input: 1.25, output: 1.75, total: 3 },
    });

    const enriched = buildJobRuntimeEvidence(piJob(), result);
    expect(enriched.requested?.model).toBe("glm-5.3-requested");
    expect(enriched.resolved?.model).toBe("glm-5.3");
    expect(enriched.observed).toMatchObject({
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
    });
    expect(enriched.infrastructureProvider).toBe("zipu");
    expect(buildUsagePayloadFields({ ...result, runtimeEvidence: enriched }))
      .toMatchObject({
        runtimeEvidence: enriched,
        tokensUsed: 30,
        inputTokens: 20,
        outputTokens: 8,
        cacheReadTokens: 3,
        cacheCreationTokens: 2,
        reasoningTokens: 3,
        cost: 3,
        costDetail: { input: 1.25, output: 1.75, total: 3 },
      });

    const piNativeEvents = native.filter(
      (event) => event.sourceFormat === "pi-rpc",
    );
    expect(piNativeEvents).toHaveLength(1);
    expect(piNativeEvents[0]).toMatchObject({
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
    });
    expect(piNativeEvents[0]?.provider).not.toBe(
      piNativeEvents[0]?.aiProvider,
    );
    expect(native.some((event) => event.provider === "zai")).toBe(false);
  });

  it("transports explicit unavailable without zero or estimated cost", async () => {
    const context = createPiMappingContext();
    const terminal = finalizePiTurn("pi-runtime-session", context, {
      observedSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
    });
    const idle = terminal.canonicalEvents.find((event) => event.kind === "session.idle")!;
    const result = await consumeSseEvents(
      {
        workerClient: createWorkerClient(),
        containerManager: {} as never,
        config: {},
      },
      {
        sessionManager: createSessionManager([
          { data: JSON.stringify({ type: "session.idle", properties: idle }) },
        ]),
        sessionId: "runner-session-unavailable",
        jobId: "job-pi-unavailable",
        isPlanningJob: false,
        eventLogger: createEventLogger(),
        redactor: createJobSecretRedactor(),
      },
    );

    expect(result.runtimeEvidence?.usage).toEqual({
      status: "unavailable",
      reason: "not_reported",
    });
    expect(result.tokensUsed).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
    expect(result.runtimeEvidence?.usage).not.toHaveProperty("totalTokens");
    expect(result.runtimeEvidence?.usage).not.toHaveProperty("cost");

    const enriched = buildJobRuntimeEvidence(piJob(), result);
    expect(enriched).toMatchObject({
      usage: { status: "unavailable", reason: "not_reported" },
      requested: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3-requested",
      },
      resolved: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
      observed: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
      infrastructureProvider: "zipu",
    });
    expect(buildUsagePayloadFields({
      ...result,
      runtimeEvidence: enriched,
    })).toEqual({ runtimeEvidence: enriched });
  });
});
