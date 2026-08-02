import { describe, expect, it } from "bun:test";
import { createOpenCodeSessionManager } from "./session-manager";

const asFetch = (
  fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => fn as unknown as typeof fetch;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("OpenCodeSessionManager", () => {
  it("unwraps success envelopes and sends auth headers", async () => {
    let authHeader = "";
    let visitedPath = "";

    const manager = createOpenCodeSessionManager(
      {
        baseUrl: "http://localhost:4096",
        auth: { token: "token-123" },
      },
      {
        fetchFn: asFetch(async (input, init) => {
          authHeader = new Headers(init?.headers).get("authorization") ?? "";
          visitedPath = String(input);
          return jsonResponse(200, {
            success: true,
            data: [{ id: "s1", status: "active" }],
          });
        }),
      }
    );

    const sessions = await manager.listSessions();

    expect(authHeader).toBe("Bearer token-123");
    expect(visitedPath).toContain("/session");
    expect(sessions).toEqual([{ id: "s1", status: "active" }]);
  });

  it("creates sessions with an empty JSON body — opencode >=1.x rejects cwd/model/provider", async () => {
    let capturedBody = "";
    let capturedPath = "";

    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096" },
      {
        fetchFn: asFetch(async (input, init) => {
          capturedPath = String(input);
          capturedBody = String(init?.body ?? "");
          return jsonResponse(200, { id: "ses_1", status: "active" });
        }),
      }
    );

    const session = await manager.createSession({
      cwd: "/workspace/repo",
      model: "glm-5.2",
      provider: "zai",
      metadata: { interactive: true },
    });

    // The model/provider come from the injected opencode.json config; the
    // session create endpoint accepts none of the legacy fields.
    expect(capturedPath).toContain("/session");
    expect(JSON.parse(capturedBody)).toEqual({});
    expect(session).toEqual({ id: "ses_1", status: "active" });
  });

  it("sends prompt payload", async () => {
    let capturedBody = "";

    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096" },
      {
        fetchFn: asFetch(async (_input, init) => {
          capturedBody = String(init?.body ?? "");
          return jsonResponse(200, { success: true, data: { ok: true } });
        }),
      }
    );

    const result = await manager.sendPrompt("session-1", {
      prompt: "Implement feature",
    });

    expect(capturedBody).toContain("Implement feature");
    expect(result).toEqual({ ok: true });
  });

  it("aborts an in-flight async prompt with the caller's live signal", async () => {
    let capturedSignal: AbortSignal | null = null;
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096", timeoutMs: 30_000 },
      {
        fetchFn: asFetch(async (_input, init) => {
          capturedSignal = init?.signal ?? null;
          return request;
        }),
      },
    );
    const boundaryController = new AbortController();

    const prompt = manager.sendPromptAsync(
      "session-1",
      { prompt: "Do not cross the cutoff" },
      { signal: boundaryController.signal, timeoutMs: 30_000 },
    );
    boundaryController.abort(new Error("site_build_execution_deadline_exceeded"));
    await Promise.resolve();

    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
    resolveRequest(new Response("", { status: 204 }));
    await expect(prompt).rejects.toThrow("site_build_execution_deadline_exceeded");
  });

  it("aborts an in-flight session creation with the caller's live signal", async () => {
    let capturedSignal: AbortSignal | null = null;
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096", timeoutMs: 30_000 },
      {
        fetchFn: asFetch(async (_input, init) => {
          capturedSignal = init?.signal ?? null;
          return request;
        }),
      },
    );
    const boundaryController = new AbortController();

    const creation = manager.createSession(
      { cwd: "/workspace/repo" },
      { signal: boundaryController.signal, timeoutMs: 30_000 },
    );
    boundaryController.abort(new Error("site_build_execution_deadline_exceeded"));
    await Promise.resolve();

    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
    resolveRequest(jsonResponse(200, {
      success: true,
      data: { id: "session-created-too-late" },
    }));
    await expect(creation).rejects.toThrow(
      "site_build_execution_deadline_exceeded",
    );
  });

  it("keeps the caller deadline active while consuming a response body", async () => {
    const boundaryController = new AbortController();
    let bodyStarted = false;
    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096", timeoutMs: 30_000 },
      {
        fetchFn: asFetch(async () => ({
          ok: true,
          status: 200,
          text: async () => {
            bodyStarted = true;
            boundaryController.abort(
              new Error("site_build_execution_deadline_exceeded"),
            );
            await Promise.resolve();
            return "";
          },
        }) as Response),
      },
    );

    await expect(manager.deleteSession(
      "primary-session-with-stalled-body",
      { signal: boundaryController.signal, timeoutMs: 30_000 },
    )).rejects.toThrow("site_build_execution_deadline_exceeded");
    expect(bodyStarted).toBe(true);
  });

  it("deletes a session via DELETE on the session path", async () => {
    let method = "";
    let visitedPath = "";

    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096" },
      {
        fetchFn: asFetch(async (input, init) => {
          method = (init?.method ?? "GET").toUpperCase();
          visitedPath = String(input);
          return new Response("", { status: 204 });
        }),
      }
    );

    await manager.deleteSession("primary-session-123");

    expect(method).toBe("DELETE");
    expect(visitedPath).toContain("/session/primary-session-123");
  });

  it("propagates errors from deleteSession when the server rejects", async () => {
    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096" },
      {
        fetchFn: asFetch(async () =>
          jsonResponse(500, { success: false, error: "boom" })
        ),
      }
    );

    await expect(manager.deleteSession("s-1")).rejects.toThrow();
  });

  it("uses a runtime-neutral label for HTTP failures", async () => {
    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096" },
      {
        fetchFn: asFetch(async () =>
          jsonResponse(404, { success: false, error: "missing route" })
        ),
      }
    );

    await expect(manager.deleteSession("s-1")).rejects.toThrow(
      "Agent session API error 404"
    );
  });

  it("reads the OpenCode 1.18 MCP status contract", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const manager = createOpenCodeSessionManager(
      { baseUrl: "http://localhost:4096" },
      {
        fetchFn: asFetch(async (input, init) => {
          requests.push({
            method: (init?.method ?? "GET").toUpperCase(),
            path: new URL(String(input)).pathname,
          });
          return jsonResponse(200, {
            scraper: { status: "connected" },
            private_docs: {
              status: "failed",
              error: "gateway unavailable",
            },
          });
        }),
      },
    );

    await expect(manager.getMcpStatus()).resolves.toEqual({
      scraper: { status: "connected" },
      private_docs: {
        status: "failed",
        error: "gateway unavailable",
      },
    });
    expect(requests).toEqual([{ method: "GET", path: "/mcp" }]);
  });
});
