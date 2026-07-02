import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AuthError,
  createAlmirantWorkerClient,
} from "./worker-client";

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

  it("encodes provider-key context query params", async () => {
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

    await client.getProviderKeys(["openai-compatible"], {
      jobId: "job-1",
      createdByUserId: "user-1",
      workspaceId: "org-1",
    });

    expect(requestedUrl).toContain("/workers/provider-keys?");
    expect(requestedUrl).toContain("providers=openai-compatible");
    expect(requestedUrl).toContain("jobId=job-1");
    expect(requestedUrl).toContain("createdByUserId=user-1");
    expect(requestedUrl).toContain("workspaceId=org-1");
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
