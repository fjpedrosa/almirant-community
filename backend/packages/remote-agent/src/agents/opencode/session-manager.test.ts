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

});
