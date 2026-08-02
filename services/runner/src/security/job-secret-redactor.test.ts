import { describe, expect, it } from "bun:test";
import type {
  AgentOutputEvent,
  CanonicalEventEnvelope,
  NativeEventEnvelope,
  StreamPublisher,
} from "@almirant/stream-consumer";
import {
  createJobSafeConsole,
  createJobSecretRedactor,
  createRedactingStreamPublisher,
  registerSensitiveValuesFromObject,
} from "./job-secret-redactor";

describe("job-scoped secret redaction", () => {
  it("redacts exact literal and URL-encoded values recursively", () => {
    const secret = "mcp/session+token?scope=browser&mode=write";
    const redactor = createJobSecretRedactor();
    redactor.register("mcp_session_token", secret);

    const redacted = redactor.redactValue({
      message: `raw=${secret}`,
      nested: {
        url: `https://example.test/callback?token=${encodeURIComponent(secret)}`,
      },
      values: [secret, { untouched: "safe" }],
    });
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(encodeURIComponent(secret));
    expect(serialized).toContain("[REDACTED:JOB_SECRET]");
    expect(redacted.values[1]).toEqual({ untouched: "safe" });
  });

  it("registers only values under secret-bearing object keys", () => {
    const redactor = createJobSecretRedactor();
    registerSensitiveValuesFromObject(redactor, {
      env: {
        SCRAPER_SESSION_TOKEN: "scraper-session-token-exact",
        PUBLIC_SITE_URL: "https://public.example",
      },
      delivery: {
        password: "delivery-password-exact",
      },
    });

    const redacted = redactor.redactString(
      "scraper-session-token-exact delivery-password-exact https://public.example",
    );

    expect(redacted).not.toContain("scraper-session-token-exact");
    expect(redacted).not.toContain("delivery-password-exact");
    expect(redacted).toContain("https://public.example");
  });

  it("redacts case-insensitive percent encoding without breaking cyclic payloads", () => {
    const secret = "token/path with spaces+symbols?";
    const lowerCasePercentEncoding = encodeURIComponent(secret).replace(
      /%[0-9A-F]{2}/g,
      (match) => match.toLowerCase(),
    );
    const redactor = createJobSecretRedactor();
    redactor.register("delivery_token", secret);
    const cyclic: { value: string; self?: unknown } = {
      value: lowerCasePercentEncoding,
    };
    cyclic.self = cyclic;

    const redacted = redactor.redactValue(cyclic);

    expect(redacted.value).toBe("[REDACTED:JOB_SECRET]");
    expect(redacted.self).toBe(redacted);
  });

  it("redacts base64, base64url and URL-encoded derived representations", () => {
    const secret = "mcp-session-token+/=derived-boundary";
    const base64 = Buffer.from(secret, "utf8").toString("base64");
    const base64Url = Buffer.from(secret, "utf8").toString("base64url");
    const redactor = createJobSecretRedactor();
    redactor.register("mcp_session_token", secret);

    const redacted = redactor.redactString(
      [
        `standard=${base64}`,
        `url=${base64Url}`,
        `encoded=${encodeURIComponent(base64)}`,
      ].join(" "),
    );

    expect(redacted).not.toContain(base64);
    expect(redacted).not.toContain(base64Url);
    expect(redacted).not.toContain(encodeURIComponent(base64));
    expect(redacted.match(/\[REDACTED:JOB_SECRET\]/g)).toHaveLength(3);
  });

  it("ignores short low-entropy values so envelope ids and discriminators remain valid", () => {
    const redactor = createJobSecretRedactor();
    redactor.register("job_env_TOKEN", "a");

    expect(
      redactor.redactValue({
        jobId: "job-a",
        event: {
          kind: "agent.step",
          description: "safe",
        },
      }),
    ).toEqual({
      jobId: "job-a",
      event: {
        kind: "agent.step",
        description: "safe",
      },
    });
  });

  it("redacts every console argument through the shared job-safe sink", () => {
    const secret = "mcp-session-token-console-boundary";
    const calls: unknown[][] = [];
    const redactor = createJobSecretRedactor();
    redactor.register("mcp_session_token", secret);
    const safeConsole = createJobSafeConsole(redactor, {
      log: (...args: unknown[]) => calls.push(args),
      warn: (...args: unknown[]) => calls.push(args),
      error: (...args: unknown[]) => calls.push(args),
    });

    safeConsole.error(
      `fatal=${secret}`,
      new Error(`nested=${Buffer.from(secret).toString("base64")}`),
      { token: secret },
    );

    const serialized = JSON.stringify(calls);
    expect(calls).toHaveLength(1);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(Buffer.from(secret).toString("base64"));
    expect(serialized).toContain("[REDACTED:JOB_SECRET]");
  });

  it("wraps legacy, canonical and native publisher boundaries using late registrations", async () => {
    const secret = "late-mcp-session-token+/=exact";
    const published: unknown[] = [];
    const underlying: StreamPublisher = {
      publish: async (event) => {
        published.push(event);
        return "legacy-1";
      },
      publishCanonicalEnvelope: async (envelope) => {
        published.push(envelope);
        return "canonical-1";
      },
      publishNativeEnvelope: async (envelope) => {
        published.push(envelope);
        return "native-1";
      },
      close: async () => {},
    };
    const redactor = createJobSecretRedactor();
    const publisher = createRedactingStreamPublisher(underlying, redactor);

    // MCP tokens are obtained after logger/publisher construction.
    redactor.register("mcp_session_token", secret);

    await publisher.publish({
      type: "rich_message",
      jobId: "job-1",
      sessionId: "session-1",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      timestamp: Date.now(),
      sequenceNumber: 1,
      payload: { token: secret },
    } satisfies AgentOutputEvent);
    await publisher.publishCanonicalEnvelope({
      jobId: "job-1",
      sessionId: "session-1",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      timestamp: Date.now(),
      sequenceNumber: 2,
      event: {
        kind: "system.info",
        message: `canonical=${encodeURIComponent(secret)}`,
      },
    } satisfies CanonicalEventEnvelope);
    await publisher.publishNativeEnvelope({
      jobId: "job-1",
      sessionId: "session-1",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      timestamp: Date.now(),
      sequenceNumber: 3,
      nativeEventType: "runtime.output",
      sourceFormat: "runtime.v1",
      payload: { nested: { credential: secret } },
    } satisfies NativeEventEnvelope);

    expect(published).toHaveLength(3);
    expect(JSON.stringify(published)).not.toContain(secret);
    expect(JSON.stringify(published)).not.toContain(encodeURIComponent(secret));
  });
});
