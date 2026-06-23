import { afterEach, describe, expect, it } from "bun:test";
import { buildApiRequestUrl, githubAppApi, request, requestWithMeta } from "./client";

describe("buildApiRequestUrl", () => {
  it("joins the canonical /api base with normal endpoints", () => {
    expect(buildApiRequestUrl("/api", "/instance/tailscale/status")).toBe(
      "/api/instance/tailscale/status"
    );
  });

  it("does not duplicate /api when callers pass a legacy /api-prefixed endpoint", () => {
    expect(buildApiRequestUrl("/api", "/api/instance/tailscale/status")).toBe(
      "/api/instance/tailscale/status"
    );
  });

  it("normalizes duplicated /api suffixes in configured API bases", () => {
    expect(buildApiRequestUrl("/api/api", "/onboarding/status")).toBe(
      "/api/onboarding/status"
    );
  });

  it("normalizes both absolute bases and legacy endpoints", () => {
    expect(
      buildApiRequestUrl(
        "https://macbook-m1-pro.tail6de2a1.ts.net/api/api",
        "/api/instance/tailscale/status"
      )
    ).toBe("https://macbook-m1-pro.tail6de2a1.ts.net/api/instance/tailscale/status");
  });

  it("keeps GitHub manifest endpoint relative to API_BASE instead of embedding /api twice", () => {
    expect(
      buildApiRequestUrl(
        "/api",
        githubAppApi.getManifestUrl({
          state: "state-123",
          appName: "Almirant Test",
          returnTo: "/onboarding",
        })
      )
    ).toBe(
      "/api/instance/github-app/manifest?state=state-123&appName=Almirant+Test&returnTo=%2Fonboarding"
    );
  });
});


const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("request credentials", () => {
  it("includes browser cookies by default for protected API calls", async () => {
    let init: RequestInit | undefined;

    globalThis.fetch = (async (_input: RequestInfo | URL, requestInit?: RequestInit) => {
      init = requestInit;
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await request<{ ok: boolean }>("/github/available-installations");

    expect(init?.credentials).toBe("include");
  });

  it("includes browser cookies by default for paginated API calls", async () => {
    let init: RequestInit | undefined;

    globalThis.fetch = (async (_input: RequestInfo | URL, requestInit?: RequestInit) => {
      init = requestInit;
      return new Response(
        JSON.stringify({
          success: true,
          data: [],
          meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    await requestWithMeta<unknown[]>("/work-items");

    expect(init?.credentials).toBe("include");
  });

  it("allows callers to override the credentials mode", async () => {
    let init: RequestInit | undefined;

    globalThis.fetch = (async (_input: RequestInfo | URL, requestInit?: RequestInit) => {
      init = requestInit;
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await request<{ ok: boolean }>("/github/available-installations", {
      credentials: "omit",
    });

    expect(init?.credentials).toBe("omit");
  });
});
