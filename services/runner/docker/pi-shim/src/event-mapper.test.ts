import { describe, expect, it } from "bun:test";
import {
  PiEventProtocolError,
  computeSessionStatsDelta,
  createPiMappingContext,
  finalizePiTurn,
  mapPiEventToShim,
  projectPiNativeEvent,
} from "./event-mapper.js";

const lifecyclePath = `${import.meta.dir}/../../../test/fixtures/pi-0.84.2/rpc-lifecycle-v1.jsonl`;
const usageReplayPath = `${import.meta.dir}/../../../test/fixtures/pi-0.84.2/rpc-usage-replay-v1.jsonl`;
const invalidAuthPath = `${import.meta.dir}/../../../test/fixtures/pi-0.84.2/rpc-invalid-auth-v1.jsonl`;
const trustedZaiEndpoint = { trustedFixedEndpointProvider: "zai" } as const;

const fixtureRecords = async (path: string): Promise<Record<string, unknown>[]> =>
  (await Bun.file(path).text())
    .trimEnd()
    .split("\n")
    .map((line) => (JSON.parse(line) as { record: Record<string, unknown> }).record);

const lifecycleRecords = (): Promise<Record<string, unknown>[]> =>
  fixtureRecords(lifecyclePath);

const usageReplayRecords = (): Promise<Record<string, unknown>[]> =>
  fixtureRecords(usageReplayPath);

const terminalUsageSummary = (
  terminal: ReturnType<typeof finalizePiTurn>,
): Record<string, unknown> => {
  const idle = terminal.canonicalEvents.find((event) => event.kind === "session.idle");
  return (idle?.metadata as { usageSummary: Record<string, unknown> }).usageSummary;
};

describe("Pi event mapping", () => {
  it("maps WU-1 text/thinking/tool lifecycle and treats agent_end as nonterminal", async () => {
    const context = createPiMappingContext();
    const legacy: unknown[] = [];
    const canonical: Array<Record<string, unknown>> = [];
    let settlements = 0;

    for (const event of await lifecycleRecords()) {
      if (event.type === "response" || ["get_state", "set_model", "prompt", "abort", "get_session_stats"].includes(String(event.type))) {
        continue;
      }
      const mapped = mapPiEventToShim("session-1", event, context);
      legacy.push(...mapped.events);
      canonical.push(...(mapped.canonicalEvents as Array<Record<string, unknown>>));
      if (mapped.settlement) settlements += 1;
      if (event.type === "agent_end") expect(mapped.settlement).toBeUndefined();
    }

    expect(settlements).toBe(1);
    expect(legacy).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "message.part.delta",
        properties: expect.objectContaining({ delta: "Reviewing the contract.", contentType: "thinking" }),
      }),
      expect.objectContaining({
        type: "message.part.delta",
        properties: expect.objectContaining({ delta: "The fixture is consistent.", contentType: "text" }),
      }),
    ]));
    expect(canonical).toEqual(expect.arrayContaining([
      { kind: "agent.thinking", content: "Reviewing the contract." },
      { kind: "agent.text", content: "The fixture is consistent." },
      { kind: "agent.text.complete", fullText: "The fixture is consistent." },
      expect.objectContaining({
        kind: "agent.tool_call.start",
        toolCallId: expect.stringMatching(/^rti_sha256_[a-f0-9]{64}$/),
        toolName: "Read",
      }),
      expect.objectContaining({
        kind: "agent.tool_call.result",
        toolCallId: expect.stringMatching(/^rti_sha256_[a-f0-9]{64}$/),
        success: true,
      }),
    ]));
    expect(context.streamingUsage?.output).toBe(3);
    expect(context.finalMessageUsage?.output).toBe(4);
    expect(context.finalMessageUsage?.reasoning).toBe(2);
  });

  it("classifies four identical 58-byte Z.AI diagnostics with duplicate auth statuses once at settlement", async () => {
    const context = createPiMappingContext();
    const records = await fixtureRecords(invalidAuthPath);
    const mapped = records.map((event) => mapPiEventToShim(
      "session-auth",
      event,
      context,
      trustedZaiEndpoint,
    ));
    const privateMessages = records.flatMap((event) => {
      const direct = event.message as Record<string, unknown> | undefined;
      const messages = Array.isArray(event.messages)
        ? event.messages as Array<Record<string, unknown>>
        : [];
      return [
        ...(direct && Object.hasOwn(direct, "errorMessage") ? [direct] : []),
        ...messages.filter((message) => Object.hasOwn(message, "errorMessage")),
      ];
    });
    const privateDiagnostics = privateMessages
      .map((message) => message.errorMessage)
      .filter((diagnostic): diagnostic is string => typeof diagnostic === "string");

    expect(records.map((event) => event.type)).toEqual([
      "message_start",
      "message_end",
      "turn_end",
      "agent_end",
      "agent_settled",
    ]);
    expect(privateMessages).toHaveLength(4);
    expect(privateMessages.every((message) => message.stopReason === "error"))
      .toBe(true);
    expect(privateDiagnostics).toHaveLength(4);
    expect(privateDiagnostics.map((diagnostic) =>
      new TextEncoder().encode(diagnostic).byteLength
    )).toEqual([58, 58, 58, 58]);
    expect(privateDiagnostics.reduce((total, diagnostic) =>
      total + new TextEncoder().encode(diagnostic).byteLength, 0
    )).toBe(232);
    expect(new Set(privateDiagnostics).size).toBe(1);
    expect(privateDiagnostics.map((diagnostic) =>
      diagnostic.match(/(?<![A-Za-z0-9_])[0-9]{3}(?![A-Za-z0-9_])/gu)
    )).toEqual([
      ["401", "401"],
      ["401", "401"],
      ["401", "401"],
      ["401", "401"],
    ]);
    expect(mapped.slice(0, -1).every((result) => result.failureCode === undefined))
      .toBe(true);
    expect(mapped.filter((result) => result.failureCode === "PI_RPC_AUTH_ERROR"))
      .toHaveLength(1);
    expect(mapped.at(-1)).toMatchObject({
      settlement: true,
      failureCode: "PI_RPC_AUTH_ERROR",
    });
    expect(context.failed).toBe(true);
    const serializedFixtureResult = JSON.stringify({ mapped, context });
    expect(serializedFixtureResult).not.toMatch(
      /errorMessage|fingerprint|digest/,
    );
    for (const diagnostic of privateDiagnostics) {
      expect(serializedFixtureResult).not.toContain(diagnostic);
    }

    const acceptedCases = [
      [`${"x".repeat(124)} 401`],
      ["HTTP 403"],
      ["HTTP 401 then HTTP 401"],
      ["HTTP 401 then HTTP 403"],
      ["401 403 401 403"],
      ["HTTP 401", "request rejected with 401"],
      ["HTTP 401", "permission denied (403)"],
      ["FAKE_PI_PRIVATE_PREFIX HTTP 401 FAKE_PI_PRIVATE_SUFFIX"],
    ];
    for (const errorMessages of acceptedCases) {
      const distinctContext = createPiMappingContext();
      const distinctResults = errorMessages.map((errorMessage) =>
        mapPiEventToShim("session-auth", {
          type: "message_end",
          message: { role: "assistant", stopReason: "error", errorMessage },
        }, distinctContext, trustedZaiEndpoint)
      );
      distinctResults.push(mapPiEventToShim(
        "session-auth",
        { type: "agent_settled" },
        distinctContext,
        trustedZaiEndpoint,
      ));

      const caseLabel = errorMessages.join(" | ");
      expect(distinctResults.at(-1)?.failureCode, caseLabel)
        .toBe("PI_RPC_AUTH_ERROR");
      const serializedResults = JSON.stringify(distinctResults);
      for (const errorMessage of errorMessages) {
        expect(serializedResults, caseLabel).not.toContain(errorMessage);
      }
      expect(serializedResults, caseLabel).not.toMatch(
        /FAKE_PI_PRIVATE|errorMessage|fingerprint|digest/,
      );
    }
  });

  it("keeps zero-status, mixed, excessive, oversized, non-string, and untrusted diagnostics generic", () => {
    const genericTerminal = (
      errorMessages: unknown[],
      options: Parameters<typeof mapPiEventToShim>[3] = trustedZaiEndpoint,
    ) => {
      const context = createPiMappingContext();
      const mapped = errorMessages.map((errorMessage) => mapPiEventToShim(
        "session-generic",
        {
          type: "message_end",
          message: { role: "assistant", stopReason: "error", errorMessage },
        },
        context,
        options,
      ));
      mapped.push(mapPiEventToShim(
        "session-generic",
        { type: "agent_settled" },
        context,
        options,
      ));
      const terminal = finalizePiTurn("session-generic", context);
      return { context, mapped, terminal };
    };

    const genericCases: unknown[][] = [
      ["HTTP 1401"],
      ["arbitrary provider failure"],
      ["HTTP 429"],
      ["HTTP 404"],
      ["network failure"],
      ["request timeout"],
      ["HTTP 401 / HTTP 429"],
      ["HTTP 401 / HTTP 404"],
      ["401 401 401 401 401"],
      ["HTTP 401", "HTTP 429"],
      ["HTTP 401", "HTTP 404"],
      ["HTTP 401", "network failure"],
      [`${"x".repeat(125)} 401`],
      [`${"é".repeat(63)} 401`],
      Array.from({ length: 5 }, () => `${"x".repeat(123)} 401`),
      Array.from({ length: 9 }, () => "HTTP 401"),
      [401],
      [null],
    ];

    for (const errorMessages of genericCases) {
      const { mapped, terminal } = genericTerminal(errorMessages);
      const caseLabel = JSON.stringify(errorMessages);
      expect(mapped.some((result) => result.failureCode !== undefined), caseLabel)
        .toBe(false);
      expect(terminal.canonicalEvents, caseLabel).toContainEqual(
        expect.objectContaining({
          kind: "session.error",
          errorCode: "PI_RPC_AGENT_ERROR",
          recoverable: false,
        }),
      );
      const serializedResult = JSON.stringify({ mapped, terminal });
      expect(serializedResult, caseLabel)
        .not.toMatch(/errorMessage|fingerprint|digest/);
      for (const errorMessage of errorMessages) {
        if (typeof errorMessage === "string") {
          expect(serializedResult, caseLabel).not.toContain(errorMessage);
        }
      }
    }

    const untrusted = genericTerminal(["HTTP 401", "HTTP 401"], {});
    expect(untrusted.mapped.some((result) => result.failureCode !== undefined))
      .toBe(false);
    expect(JSON.stringify(untrusted)).not.toMatch(
      /HTTP 401|errorMessage|fingerprint|digest/,
    );
  });

  it("never sums cumulative message_update usage snapshots", () => {
    const context = createPiMappingContext();
    for (const output of [1, 3, 7]) {
      mapPiEventToShim("session-1", {
        type: "message_update",
        usage: { input: 10, output, reasoning: 1, totalTokens: 10 + output },
      }, context);
    }
    expect(context.streamingUsage).toMatchObject({ input: 10, output: 7, totalTokens: 17 });
  });

  it("reports streaming-only usage as explicitly unavailable instead of treating a snapshot as terminal", () => {
    const context = createPiMappingContext();
    mapPiEventToShim("session-1", {
      type: "message_update",
      usage: {
        input: 90,
        output: 9,
        reasoning: 4,
        cacheRead: 8,
        cacheWrite: 7,
        totalTokens: 106,
        cost: { total: 12.5 },
      },
    }, context);

    expect(terminalUsageSummary(finalizePiTurn("session-1", context))).toEqual({
      status: "unavailable",
      reason: "not_reported",
    });
  });

  it("reports no aggregate or final usage as explicitly unavailable without zero-filled metrics", () => {
    const terminal = finalizePiTurn("session-1", createPiMappingContext(), {
      observedSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
    });
    const summary = terminalUsageSummary(terminal);
    const idle = terminal.canonicalEvents.find((event) => event.kind === "session.idle");

    expect(summary).toEqual({ status: "unavailable", reason: "not_reported" });
    expect(summary).not.toHaveProperty("inputTokens");
    expect(summary).not.toHaveProperty("totalTokens");
    expect(summary).not.toHaveProperty("totalCostUsd");
    expect((idle?.metadata as Record<string, unknown>).runtimeEvidence).toEqual({
      schemaVersion: "runtime-evidence-v1",
      usage: { status: "unavailable", reason: "not_reported" },
      observed: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
      },
    });
  });

  it("deduplicates replayed final messages by stable identity and sums distinct messages exactly once", async () => {
    const context = createPiMappingContext();
    for (const event of await usageReplayRecords()) {
      if (event.type === "message_end") {
        mapPiEventToShim("session-1", event, context);
      }
    }

    expect(terminalUsageSummary(finalizePiTurn("session-1", context))).toEqual({
      inputTokens: 12,
      outputTokens: 10,
      reasoningTokens: 3,
      cacheReadTokens: 5,
      cacheCreationTokens: 5,
      totalTokens: 27,
      totalCostUsd: 3,
      costDetail: { input: 1.25, output: 1.75, total: 3 },
    });
  });

  it("uses deduplicated final messages when terminal stats are empty or partial", async () => {
    for (const sessionStatsDelta of [{}, { input: 999 }]) {
      const context = createPiMappingContext();
      for (const event of await usageReplayRecords()) {
        if (event.type === "message_end") {
          mapPiEventToShim("session-1", event, context);
        }
      }

      expect(terminalUsageSummary(finalizePiTurn("session-1", context, {
        sessionStatsDelta,
      }))).toMatchObject({
        inputTokens: 12,
        outputTokens: 10,
        totalTokens: 27,
        totalCostUsd: 3,
      });
    }
  });

  it("emits versioned terminal evidence with accurate source, identities, and exact observed selection", async () => {
    const context = createPiMappingContext();
    for (const event of await usageReplayRecords()) {
      if (event.type === "message_end") {
        mapPiEventToShim("session-1", event, context);
      }
    }

    const terminal = finalizePiTurn("session-1", context, {
      observedSelection: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        reasoningLevel: "high",
      },
    });
    const idle = terminal.canonicalEvents.find((event) => event.kind === "session.idle");
    const metadata = idle?.metadata as Record<string, unknown>;

    expect(metadata.runtimeEvidence).toMatchObject({
      schemaVersion: "runtime-evidence-v1",
      usage: {
        status: "reported",
        source: "final_messages",
        inputTokens: 12,
        outputTokens: 10,
        reasoningTokens: 3,
        cacheReadTokens: 5,
        cacheWriteTokens: 5,
        totalTokens: 27,
        cost: {
          totalUsd: 3,
          detail: { input: 1.25, output: 1.75, total: 3 },
        },
      },
      observed: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        reasoningLevel: "high",
      },
    });
    const identities = (
      metadata.runtimeEvidence as {
        usage: { identities: Array<{ messageId: string }> };
      }
    ).usage.identities;
    expect(identities).toHaveLength(2);
    expect(identities[0]?.messageId).toMatch(/^rti_sha256_[a-f0-9]{64}$/);
    expect(identities[1]?.messageId).toMatch(/^rti_sha256_[a-f0-9]{64}$/);
    expect(identities[0]?.messageId).not.toBe(identities[1]?.messageId);
    expect(JSON.stringify(identities)).not.toMatch(
      /raw-prefix|raw-suffix|FAKE_REPLAY|Bearer|sk-/,
    );
  });

  it("requires stable tool IDs and settles unresolved tools as interrupted, never successful", () => {
    const context = createPiMappingContext();
    expect(() => mapPiEventToShim("session-1", { type: "tool_start", toolName: "bash" }, context))
      .toThrow("PI_RPC_PROTOCOL_ERROR");
    expect(() => mapPiEventToShim("session-1", {
      type: "tool_end",
      toolCallId: "unknown",
      toolName: "bash",
      success: true,
    }, context)).toThrow(PiEventProtocolError);

    const active = createPiMappingContext();
    mapPiEventToShim("session-1", {
      type: "tool_start",
      toolCallId: "call-active",
      toolName: "bash",
      arguments: { command: "sleep 10" },
    }, active);
    active.aborted = true;
    const terminal = finalizePiTurn("session-1", active, { failureCode: "PI_RPC_CANCELLED" });
    expect(terminal.terminal).toBe(true);
    expect(terminal.canonicalEvents).toContainEqual(expect.objectContaining({
      kind: "agent.tool_call.result",
      toolCallId: expect.stringMatching(/^rti_sha256_[a-f0-9]{64}$/),
      success: false,
      outputPreview: "interrupted",
    }));
    expect(JSON.stringify(terminal.canonicalEvents)).not.toContain("call-active");
    expect(terminal.events.at(-1)).toEqual({ type: "session.idle", properties: { sessionId: "session-1" } });
  });

  it("makes a verified session-stat aggregate authoritative while preserving provider-only final reasoning/cost detail", () => {
    const context = createPiMappingContext();
    mapPiEventToShim("session-1", {
      type: "message_end",
      message: {
        role: "assistant",
        usage: {
          input: 12,
          output: 4,
          reasoning: 2,
          cacheRead: 1,
          cacheWrite: 0,
          totalTokens: 17,
          cost: { input: 0.01, output: 0.04, total: 0.05 },
        },
      },
    }, context);

    const delta = computeSessionStatsDelta(
      { input: 112, output: 44, cacheRead: 6, cacheWrite: 2, totalTokens: 164 },
      { input: 100, output: 40, cacheRead: 5, cacheWrite: 2, totalTokens: 147 },
    );
    expect(delta).toEqual({ input: 12, output: 4, cacheRead: 1, cacheWrite: 0, totalTokens: 17 });

    const authoritative = {
      input: 20,
      output: 8,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 30,
    };
    const terminal = finalizePiTurn("session-1", context, {
      sessionStatsDelta: authoritative,
    });
    expect(terminal.canonicalEvents).toContainEqual(expect.objectContaining({
      kind: "session.idle",
      metadata: expect.objectContaining({
        usageSummary: {
          inputTokens: 20,
          outputTokens: 8,
          reasoningTokens: 2,
          cacheReadTokens: 3,
          cacheCreationTokens: 2,
          totalTokens: 30,
          totalCostUsd: 0.05,
          costDetail: { input: 0.01, output: 0.04, total: 0.05 },
        },
      }),
    }));

    expect(finalizePiTurn("session-1", context, { sessionStatsDelta: authoritative })).toEqual({
      events: [],
      canonicalEvents: [],
      terminal: true,
    });
  });

  it("redacts raw Bash commands, argument previews, credential-like tool IDs, and failure diagnostics from every emitted surface", () => {
    const context = createPiMappingContext();
    const mapped = mapPiEventToShim("session-1", {
      type: "tool_start",
      toolCallId: "raw-prefix-sk-FAKE_TOOL_ID_SENTINEL_123456-raw-suffix",
      toolName: "bash",
      arguments: {
        command: "curl https://user:pass@example.test?q=FAKE_COMMAND_URL_SENTINEL -H 'Authorization: Bearer FAKE_COMMAND_BEARER_123456'",
        env: { API_KEY: "sk-FAKE_COMMAND_API_KEY_123456" },
      },
    }, context);
    const serialized = JSON.stringify(mapped);
    const start = mapped.canonicalEvents.find(
      (event) => event.kind === "agent.tool_call.start",
    );
    const bash = mapped.canonicalEvents.find(
      (event) => event.kind === "agent.bash.execute",
    );

    expect(start?.toolCallId).toMatch(/^rti_sha256_[a-f0-9]{64}$/);
    expect(start).not.toHaveProperty("inputPreview");
    expect(bash).toMatchObject({
      kind: "agent.bash.execute",
      toolCallId: expect.stringMatching(/^rti_sha256_[a-f0-9]{64}$/),
      command: "[redacted]",
    });
    expect(serialized).not.toMatch(
      /raw-prefix|raw-suffix|FAKE_COMMAND|user:pass|example\.test|Bearer|sk-/,
    );

    const failed = finalizePiTurn("session-1", context, {
      failureCode: "sk-FAKE_FAILURE_CODE_SENTINEL_123456",
      failureMessage: "failed curl https://example.test with Bearer FAKE_FAILURE_BEARER_123456",
    });
    const failedSerialized = JSON.stringify(failed);
    expect(failedSerialized).not.toMatch(
      /FAKE_FAILURE|example\.test|Bearer|sk-/,
    );
    expect(failed.canonicalEvents).toContainEqual(expect.objectContaining({
      kind: "session.error",
      message: "Pi turn failed",
      errorCode: "PI_RPC_RUNTIME_ERROR",
    }));
  });
});

describe("Pi native diagnostic projection", () => {
  it("allowlists and recursively redacts without raw arguments, results, URLs, or token fragments", () => {
    const projected = projectPiNativeEvent({
      type: "tool_end",
      toolCallId: "call-1",
      toolName: "bash",
      success: false,
      arguments: { command: "curl https://example.test -H 'Authorization: Bearer secret-token'" },
      result: { headers: { authorization: "Bearer secret-token" }, token: "sk-secret-token" },
      message: "failed at https://example.test with Bearer abc.def.ghi and sk-secret-token",
    });
    const serialized = JSON.stringify(projected);
    expect(projected).toEqual({
      type: "tool_end",
      toolCallId: expect.stringMatching(/^rti_sha256_[a-f0-9]{64}$/),
      toolName: "bash",
      success: false,
    });
    expect(serialized).not.toContain("call-1");
    expect(serialized).not.toMatch(/arguments|result|headers|Authorization|example\.test|secret-token/);
  });

  it("preserves normal assistant text while redacting nested URL credentials and known token patterns", () => {
    const normal = projectPiNativeEvent({
      type: "text_update",
      delta: "Normal assistant text remains intact.",
      nested: {
        config: { url: "https://user:pass@example.test?q=FAKE_NATIVE_URL_SENTINEL" },
        logs: ["Bearer FAKE_NATIVE_BEARER_SENTINEL_123456"],
      },
    });
    expect(normal).toEqual({
      type: "text_update",
      delta: "Normal assistant text remains intact.",
    });

    const redacted = projectPiNativeEvent({
      type: "text_update",
      delta: "See https://user:pass@example.test?q=FAKE_NATIVE_QUERY_SENTINEL with Bearer FAKE_NATIVE_TOKEN_123456",
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).toContain("[redacted-url]");
    expect(serialized).toContain("[redacted-token]");
    expect(serialized).not.toMatch(/user:pass|example\.test|FAKE_NATIVE/);
  });

  it("replaces oversized diagnostics with a typed safe marker and drops unknown event types", () => {
    expect(projectPiNativeEvent({ type: "unknown_event", token: "secret" })).toBeNull();
    expect(projectPiNativeEvent({ type: "text_update", contentIndex: 1, delta: "x".repeat(10_000) }, 512))
      .toEqual({
        type: "text_update",
        diagnostic: { kind: "pi.native_projection_oversized", dropped: true },
      });
  });
});
