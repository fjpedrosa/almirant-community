import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AuthError,
  ConflictError,
  createAlmirantWorkerClient,
} from "./worker-client";
import type {
  ProviderKeyRequestContext,
  UpdateJobStatusPayload,
} from "./types";

const jsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
};

describe("createAlmirantWorkerClient", () => {
  const originalFetch = globalThis.fetch;

  const setMockFetch = (
    implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  ): void => {
    globalThis.fetch = implementation as unknown as typeof fetch;
  };

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends Bearer auth and unwraps success envelopes", async () => {
    let authHeader = "";

    setMockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("authorization") ?? "";
      return jsonResponse({ success: true, data: { ok: true } });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const result = await client.heartbeat({
      workerId: "worker-1",
      hostname: "host-1",
    });

    expect(authHeader).toBe("Bearer test-key");
    expect(result).toEqual({ ok: true });
  });

  it("retries transient HTTP failures", async () => {
    let attempts = 0;

    setMockFetch(async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ success: false, error: "temporary" }, 503);
      }
      return jsonResponse({ success: true, data: [] });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 2,
      initialRetryDelayMs: 0,
    });

    const jobs = await client.claimJobs({ workerId: "worker-1", count: 1 });

    expect(attempts).toBe(2);
    expect(jobs).toEqual([]);
  });

  it("sends exact accepted coding agents and runtime capability identity", async () => {
    const claimBodies: Record<string, unknown>[] = [];
    setMockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
      claimBodies.push(
        JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      );
      return jsonResponse({ success: true, data: [] });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });
    await client.claimJobs({
      workerId: "worker-registry",
      count: 1,
      acceptedCodingAgents: ["claude-code", "codex", "opencode", "pi"],
      runtimeCapabilityIdentity: {
        schemaVersion: "runtime-capability-projection-v1",
        version: 1,
        hash: "sha256:generated",
      },
    });

    expect(claimBodies).toEqual([{
      workerId: "worker-registry",
      count: 1,
      acceptedCodingAgents: ["claude-code", "codex", "opencode", "pi"],
      runtimeCapabilityIdentity: {
        schemaVersion: "runtime-capability-projection-v1",
        version: 1,
        hash: "sha256:generated",
      },
      capabilities: ["durable.v2.receipts"],
    }]);
  });

  it("removes only explicitly rejected additive claim fields", async () => {
    const claimBodies: Record<string, unknown>[] = [];
    setMockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
      claimBodies.push(
        JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      );
      if (claimBodies.length === 1) {
        return jsonResponse(
          { success: false, error: "Unexpected property: runtimeCapabilityIdentity" },
          422,
        );
      }
      return jsonResponse({ success: true, data: [] });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });
    await client.claimJobs({
      workerId: "worker-rolling-upgrade",
      count: 1,
      acceptedCodingAgents: ["claude-code", "codex", "opencode", "pi"],
      runtimeCapabilityIdentity: {
        schemaVersion: "runtime-capability-projection-v1",
        version: 1,
        hash: "sha256:generated",
      },
    });

    expect(claimBodies).toHaveLength(2);
    expect(claimBodies[1]).toEqual({
      workerId: "worker-rolling-upgrade",
      count: 1,
      acceptedCodingAgents: ["claude-code", "codex", "opencode", "pi"],
      capabilities: ["durable.v2.receipts"],
    });
  });

  it("does not retry arbitrary claim validation failures", async () => {
    let attempts = 0;
    setMockFetch(async () => {
      attempts += 1;
      return jsonResponse({ success: false, error: "count is invalid" }, 422);
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    await expect(client.claimJobs({
      workerId: "worker-invalid",
      count: 0,
      acceptedCodingAgents: ["claude-code", "codex", "opencode", "pi"],
    })).rejects.toThrow("count is invalid");
    expect(attempts).toBe(1);
  });

  it("throws AuthError for 401/403 responses", async () => {
    setMockFetch(async () => {
      return jsonResponse({ success: false, error: "invalid token" }, 401);
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "bad-key",
      maxRetries: 0,
    });

    await expect(client.getWorkItem("wi-1")).rejects.toBeInstanceOf(AuthError);
  });

  it("transports runtime evidence and compatibility aggregates without rewriting", async () => {
    let statusBody: Record<string, unknown> = {};
    setMockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
      statusBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({ success: true, data: { ok: true } });
    });
    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });
    const runtimeEvidence = {
      schemaVersion: "runtime-evidence-v1" as const,
      usage: {
        status: "reported" as const,
        source: "terminal_aggregate" as const,
        inputTokens: 20,
        outputTokens: 8,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        reasoningTokens: 3,
        totalTokens: 30,
        cost: { totalUsd: 3, detail: { input: 1.25, output: 1.75 } },
      },
      observed: { codingAgent: "pi", aiProvider: "zai", model: "glm-5.3" },
      infrastructureProvider: "zipu" as const,
    };

    await client.updateJobStatus("job-runtime-evidence", {
      status: "completed",
      runtimeEvidence,
      tokensUsed: 30,
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      reasoningTokens: 3,
      cost: 3,
      costDetail: { input: 1.25, output: 1.75 },
    });

    expect(statusBody).toMatchObject({
      runtimeEvidence,
      tokensUsed: 30,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      reasoningTokens: 3,
      costDetail: { input: 1.25, output: 1.75 },
    });
  });

  it("keeps legacy usage-only status payloads valid while evidence is absent", async () => {
    let statusBody: Record<string, unknown> = {};
    setMockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
      statusBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({ success: true, data: { ok: true } });
    });
    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });
    const legacyPayload: UpdateJobStatusPayload = {
      status: "completed",
      tokensUsed: 10,
      inputTokens: 5,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
      reasoningTokens: 1,
      cost: 0.75,
      costDetail: { input: 0.25, output: 0.5 },
    };

    await client.updateJobStatus("job-legacy-usage", legacyPayload);

    expect(statusBody).toEqual(legacyPayload);
    expect(statusBody).not.toHaveProperty("runtimeEvidence");
  });

  it("encodes exact claim-bound provider-key context and connection selection", async () => {
    let requestedUrl = "";

    setMockFetch(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({ success: true, data: {} });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    await client.getProviderKeys(["openai-compatible", "zai"], {
      jobId: "job /1",
      workerId: "worker +/1",
      claimAttemptId: "claim/attempt +1",
      excludeConnectionIds: ["connection one", "connection/two"],
      preferredConnectionId: "preferred/connection +1",
    });

    expect(requestedUrl).toBe(
      "https://api.example.com/workers/provider-keys?" +
        "providers=openai-compatible%2Czai&" +
        "jobId=job+%2F1&" +
        "workerId=worker+%2B%2F1&" +
        "claimAttemptId=claim%2Fattempt+%2B1&" +
        "excludeConnectionIds=connection+one%2Cconnection%2Ftwo&" +
        "preferredConnectionId=preferred%2Fconnection+%2B1",
    );
  });

  it("supplies exact claim ownership for existing Community provider-key callers", async () => {
    let requestedUrl = "";
    setMockFetch(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/workers/jobs/claim")) {
        return jsonResponse({
          success: true,
          data: [{ id: "job-legacy-context", claimAttemptId: "claim-current" }],
        });
      }
      requestedUrl = String(input);
      return jsonResponse({ success: true, data: {} });
    });
    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });
    await client.claimJobs({ workerId: "worker-current", count: 1 });

    await client.getProviderKeys(["google"], {
      jobId: "job-legacy-context",
      createdByUserId: "ignored-user",
      workspaceId: "ignored-workspace",
    });

    expect(requestedUrl).toContain("workerId=worker-current");
    expect(requestedUrl).toContain("claimAttemptId=claim-current");
    expect(requestedUrl).not.toContain("createdByUserId");
    expect(requestedUrl).not.toContain("workspaceId");
  });

  it("rejects missing, blank, or stale provider-key claim context before fetch", async () => {
    let providerKeyFetches = 0;
    setMockFetch(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/workers/jobs/claim")) {
        return jsonResponse({
          success: true,
          data: [{ id: "job-stale", claimAttemptId: "claim-current" }],
        });
      }
      providerKeyFetches += 1;
      return jsonResponse({ success: true, data: {} });
    });
    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "runner-credential-material",
      maxRetries: 0,
    });
    await client.claimJobs({ workerId: "worker-current", count: 1 });

    const invalidContexts: unknown[] = [
      undefined,
      {},
      { jobId: " ", workerId: "worker-1", claimAttemptId: "claim-1" },
      { jobId: "job-1", workerId: "\t", claimAttemptId: "claim-1" },
      {
        jobId: "job-stale",
        workerId: "worker-current",
        claimAttemptId: "claim-stale",
      },
    ];
    for (const invalidContext of invalidContexts) {
      let error: unknown;
      try {
        await client.getProviderKeys(
          ["openai"],
          invalidContext as ProviderKeyRequestContext,
        );
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).not.toContain("runner-credential-material");
    }
    expect(providerKeyFetches).toBe(0);
  });

  it("preserves provider-bound bundles and Google safe debug support", async () => {
    setMockFetch(async () => jsonResponse({
      success: true,
      data: {
        googleApiKey: "google-test-key",
        credentialBundles: [{
          provider: "zai",
          connectionId: "connection-zai-1",
          authClass: "api_key",
          apiKey: "zai-test-key",
          implementationModel: "glm-5.3",
        }],
        _debug: {
          google: {
            connectionId: "connection-google-1",
            connectionName: "Google safe debug",
            provider: "google",
            authMethod: "api_key",
            tokenExpiresAt: null,
            scope: "organization",
          },
        },
      },
    }));
    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const response = await client.getProviderKeys(["zai", "google"], {
      jobId: "job-pi-1",
      workerId: "worker-pi-1",
      claimAttemptId: "claim-pi-1",
    });

    expect(response.credentialBundles?.[0]).toMatchObject({
      provider: "zai",
      authClass: "api_key",
      implementationModel: "glm-5.3",
    });
    expect(response.googleApiKey).toBe("google-test-key");
    expect(response._debug?.google).toMatchObject({
      provider: "google",
      connectionId: "connection-google-1",
    });
  });

  it("encodes quota-check provider and workspace query params", async () => {
    let requestedUrl = "";

    setMockFetch(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        success: true,
        data: {
          allowed: false,
          reason: "weekly token limit exceeded",
          resetAt: "2026-04-06T00:00:00.000Z",
          blockingQuotaType: "weekly",
        },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const result = await client.checkQuota("openai", "org-1");

    expect(requestedUrl).toContain("/workers/quota-check?");
    expect(requestedUrl).toContain("provider=openai");
    expect(requestedUrl).toContain("workspaceId=org-1");
    expect(result).toMatchObject({
      allowed: false,
      blockingQuotaType: "weekly",
    });
  });

  it("posts planning stream chunks to the worker stream endpoint", async () => {
    let requestedUrl = "";
    let requestBody = "";

    setMockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestBody = String(init?.body ?? "");
      return jsonResponse({
        success: true,
        data: { processed: 2, stepIndex: 4, interactionIds: ["interaction-1"] },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const result = await client.streamJobOutput("job-123", {
      content: "Need more context\n",
      stepIndex: 3,
      persistContent: false,
    });

    expect(requestedUrl).toContain("/workers/jobs/job-123/stream");
    expect(requestBody).toContain("\"stepIndex\":3");
    expect(requestBody).toContain("\"persistContent\":false");
    expect(result).toEqual({
      processed: 2,
      stepIndex: 4,
      interactionIds: ["interaction-1"],
    });
  });

  it("posts job log batches to the worker logs endpoint", async () => {
    let requestedUrl = "";
    let requestBody = "";

    setMockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestBody = String(init?.body ?? "");
      return jsonResponse({
        success: true,
        data: { jobId: "job-123", received: 2, inserted: 2, duplicates: 0 },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const result = await client.sendJobLogs("job-123", {
      logs: [
        {
          seq: 1,
          phase: "claim",
          eventType: "job.claimed",
          message: "claimed",
          timestamp: "2026-03-05T01:00:00.000Z",
        },
        {
          seq: 2,
          level: "debug",
          phase: "session",
          eventType: "session.created",
          message: "session ready",
          payload: { id: "s-1" },
          timestamp: "2026-03-05T01:00:01.000Z",
        },
      ],
    });

    expect(requestedUrl).toContain("/workers/jobs/job-123/logs");
    expect(requestBody).toContain("\"seq\":1");
    expect(requestBody).toContain("\"eventType\":\"job.claimed\"");
    expect(result).toEqual({
      jobId: "job-123",
      received: 2,
      inserted: 2,
      duplicates: 0,
    });
  });

  it("fetches job status from workers endpoint", async () => {
    let requestedUrl = "";

    setMockFetch(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        success: true,
        data: { status: "cancelled", shutdownRequested: true },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const status = await client.getJobStatus("job-123");

    expect(requestedUrl).toContain("/workers/jobs/job-123/status");
    expect(status).toEqual({ status: "cancelled", shutdownRequested: true });
  });

  it("requests the transcript tail when asked by completion recovery", async () => {
    let requestedUrl = "";

    setMockFetch(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        success: true,
        data: { transcript: "## Summary\n- Done" },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    await client.getJobTranscript("job-123", { limit: 1000, tail: true });

    expect(requestedUrl).toContain("/workers/jobs/job-123/transcript?");
    expect(requestedUrl).toContain("limit=1000");
    expect(requestedUrl).toContain("tail=true");
  });

  it("fetches uploaded workspace files scoped to a job", async () => {
    let requestedUrl = "";

    setMockFetch(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        success: true,
        data: {
          id: "file-123",
          fileName: "input.txt",
          fileSize: 5,
          mimeType: "text/plain",
          contentBase64: Buffer.from("hello").toString("base64"),
          workspacePath: "docs/input.txt",
        },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const file = await client.getWorkspaceFile("job-123", "file-123");

    expect(requestedUrl).toContain("/workers/jobs/job-123/workspace-files/file-123");
    expect(file).toEqual({
      id: "file-123",
      fileName: "input.txt",
      fileSize: 5,
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello").toString("base64"),
      workspacePath: "docs/input.txt",
    });
  });

  it("fetches a job-pinned agent plugin bundle descriptor", async () => {
    let requestedUrl = "";

    setMockFetch(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        success: true,
        data: {
          schemaVersion: 1,
          pluginId: "plugin-1",
          slug: "private-review",
          kind: "portable_skill",
          checksumSha256: "a".repeat(64),
          files: [
            {
              type: "file",
              path: "SKILL.md",
              contentBase64: Buffer.from("# Private review").toString("base64"),
            },
          ],
        },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const bundle = await client.getAgentPluginBundle("job-123", "plugin-1");

    expect(requestedUrl).toContain("/workers/jobs/job-123/agent-plugins/plugin-1/bundle");
    expect(bundle).toEqual({
      schemaVersion: 1,
      pluginId: "plugin-1",
      slug: "private-review",
      kind: "portable_skill",
      checksumSha256: "a".repeat(64),
      files: [
        {
          type: "file",
          path: "SKILL.md",
          contentBase64: Buffer.from("# Private review").toString("base64"),
        },
      ],
    });
  });

  it("streams worker-authenticated evidence bytes from the job/artifact endpoint", async () => {
    let requestedUrl = "";
    let authHeader = "";
    let redirectMode: RequestRedirect | undefined;
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    setMockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      authHeader = new Headers(init?.headers).get("authorization") ?? "";
      redirectMode = init?.redirect;
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(bytes.length),
          "x-almirant-artifact-size": String(bytes.length),
          "x-almirant-artifact-sha256": "a".repeat(64),
        },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    const artifact = await client.getEvidenceArtifact("job/123", "artifact/123");
    const received = Buffer.from(await new Response(artifact.body).arrayBuffer());

    expect(requestedUrl).toContain(
      "/workers/jobs/job%2F123/evidence-artifacts/artifact%2F123",
    );
    expect(authHeader).toBe("Bearer test-key");
    expect(redirectMode).toBe("error");
    expect(received).toEqual(bytes);
    expect(artifact).toMatchObject({
      contentType: "image/png",
      byteSize: bytes.length,
      sha256: "a".repeat(64),
    });
  });

  it("rejects evidence responses that omit integrity headers", async () => {
    setMockFetch(async () => new Response(Buffer.from("bytes"), {
      status: 200,
      headers: { "content-type": "image/png" },
    }));

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    await expect(client.getEvidenceArtifact("job-123", "artifact-123"))
      .rejects.toThrow("evidence response headers");
  });

  it("rejects content-encoded evidence because byte-size headers must describe the body", async () => {
    const bytes = Buffer.from("encoded");
    setMockFetch(async () => new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.length),
        "content-encoding": "gzip",
        "x-almirant-artifact-size": String(bytes.length),
        "x-almirant-artifact-sha256": "a".repeat(64),
      },
    }));

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    await expect(client.getEvidenceArtifact("job-123", "artifact-123"))
      .rejects.toThrow("evidence response headers");
  });

  it("fetches DoD remediation candidates from the dedicated worker endpoint", async () => {
    let requestedUrl = "";

    setMockFetch(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return jsonResponse({
        success: true,
        data: {
          candidates: [],
          skipped: {
            excluded: [],
            blocked: [],
            active: [],
            concurrency: [],
            recentlyModified: [],
            dodIncomplete: [],
            notDodRemediation: [],
            missingDodReport: [],
          },
        },
      });
    });

    const client = createAlmirantWorkerClient({
      apiBaseUrl: "https://api.example.com",
      apiKey: "test-key",
      maxRetries: 0,
    });

    await client.getDodRemediationCandidates({ configId: "cfg-1" });

    expect(requestedUrl).toContain("/workers/dod-remediation-candidates?");
    expect(requestedUrl).toContain("configId=cfg-1");
  });
});
