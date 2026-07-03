import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

/**
 * Characterization tests for `getAuthBootstrapStatus`, the thin client that
 * reads the auth bootstrap status from the BACKEND
 * (`GET /api/auth/bootstrap-status`, via `authBackendFetch`).
 *
 * SECURITY-CRITICAL: on any backend error/unreachable it must FAIL CLOSED —
 * `hasUsers:true` + `allowRegistration:false` so a transient blip never exposes
 * the signup form or the first-admin setup flow.
 *
 * `authBackendFetch` (from server-session) imports `next/headers`; we mock it
 * (capture real + restore in afterAll — mock.module is PROCESS-GLOBAL and leaks
 * otherwise) and stub global fetch.
 */

let realNextHeaders: unknown = {};
try {
  realNextHeaders = await import("next/headers");
} catch {
  realNextHeaders = {};
}

mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=abc" }),
  cookies: async () => ({ set: () => {} }),
}));

const realFetch = globalThis.fetch;

let fetchCalls: string[] = [];
let nextResponse: () => Response = () => new Response("null", { status: 200 });
let fetchThrows = false;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetchCalls.push(String(input));
  if (fetchThrows) throw new Error("network down");
  return nextResponse();
}) as typeof fetch;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchCalls = [];
  fetchThrows = false;
  nextResponse = () => new Response("null", { status: 200 });
});

afterAll(() => {
  mock.module("next/headers", () => realNextHeaders);
  globalThis.fetch = realFetch;
});

describe("getAuthBootstrapStatus", () => {
  it("hits the backend bootstrap-status endpoint", async () => {
    nextResponse = () =>
      jsonResponse({
        hasUsers: true,
        needsInitialAdminSetup: false,
        allowRegistration: true,
      });
    const { getAuthBootstrapStatus } = await import("./auth-bootstrap");

    await getAuthBootstrapStatus();

    expect(fetchCalls[0]).toContain("/api/auth/bootstrap-status");
  });

  it("passes through backend values wrapped in { success, data }", async () => {
    nextResponse = () =>
      jsonResponse({
        success: true,
        data: {
          hasUsers: false,
          needsInitialAdminSetup: true,
          allowRegistration: true,
        },
      });
    const { getAuthBootstrapStatus } = await import("./auth-bootstrap");

    expect(await getAuthBootstrapStatus()).toEqual({
      hasUsers: false,
      needsInitialAdminSetup: true,
      allowRegistration: true,
    });
  });

  it("passes through a bare backend object (no { data } wrapper)", async () => {
    nextResponse = () =>
      jsonResponse({
        hasUsers: false,
        needsInitialAdminSetup: false,
        allowRegistration: true,
      });
    const { getAuthBootstrapStatus } = await import("./auth-bootstrap");

    expect(await getAuthBootstrapStatus()).toEqual({
      hasUsers: false,
      needsInitialAdminSetup: false,
      allowRegistration: true,
    });
  });

  it("FAILS CLOSED on a non-2xx backend response", async () => {
    nextResponse = () => new Response("boom", { status: 500 });
    const { getAuthBootstrapStatus } = await import("./auth-bootstrap");

    expect(await getAuthBootstrapStatus()).toEqual({
      hasUsers: true,
      needsInitialAdminSetup: false,
      allowRegistration: false,
    });
  });

  it("FAILS CLOSED when the backend is unreachable (fetch throws)", async () => {
    fetchThrows = true;
    const { getAuthBootstrapStatus } = await import("./auth-bootstrap");

    expect(await getAuthBootstrapStatus()).toEqual({
      hasUsers: true,
      needsInitialAdminSetup: false,
      allowRegistration: false,
    });
  });

  it("FAILS CLOSED when the payload is malformed (missing boolean fields)", async () => {
    nextResponse = () => jsonResponse({ hasUsers: "yes" });
    const { getAuthBootstrapStatus } = await import("./auth-bootstrap");

    expect(await getAuthBootstrapStatus()).toEqual({
      hasUsers: true,
      needsInitialAdminSetup: false,
      allowRegistration: false,
    });
  });
});
