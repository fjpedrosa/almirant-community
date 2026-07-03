import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

/**
 * Characterization tests for `getInstanceOnboardingState`, the thin client that
 * reads instance onboarding state from the BACKEND
 * (`GET /api/auth/bootstrap-status`, via `authBackendFetch`).
 *
 * SECURITY-CRITICAL: on any backend error/unreachable it must FAIL SAFE —
 * `completed:true` + `hasUsers:true` so a transient blip never traps a user in
 * the setup wizard.
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

describe("getInstanceOnboardingState", () => {
  it("hits the backend bootstrap-status endpoint", async () => {
    nextResponse = () =>
      jsonResponse({ onboardingCompleted: true, hasUsers: true });
    const { getInstanceOnboardingState } = await import("./instance-status");

    await getInstanceOnboardingState();

    expect(fetchCalls[0]).toContain("/api/auth/bootstrap-status");
  });

  it("passes through backend values wrapped in { data }", async () => {
    nextResponse = () =>
      jsonResponse({
        data: { onboardingCompleted: false, hasUsers: false },
      });
    const { getInstanceOnboardingState } = await import("./instance-status");

    expect(await getInstanceOnboardingState()).toEqual({
      completed: false,
      hasUsers: false,
    });
  });

  it("passes through a bare backend object (no { data } wrapper)", async () => {
    nextResponse = () =>
      jsonResponse({ onboardingCompleted: false, hasUsers: true });
    const { getInstanceOnboardingState } = await import("./instance-status");

    expect(await getInstanceOnboardingState()).toEqual({
      completed: false,
      hasUsers: true,
    });
  });

  it("FAILS SAFE on a non-2xx backend response", async () => {
    nextResponse = () => new Response("boom", { status: 500 });
    const { getInstanceOnboardingState } = await import("./instance-status");

    expect(await getInstanceOnboardingState()).toEqual({
      completed: true,
      hasUsers: true,
    });
  });

  it("FAILS SAFE when the backend is unreachable (fetch throws)", async () => {
    fetchThrows = true;
    const { getInstanceOnboardingState } = await import("./instance-status");

    expect(await getInstanceOnboardingState()).toEqual({
      completed: true,
      hasUsers: true,
    });
  });

  it("defaults missing fields to the safe (completed/hasUsers true) values", async () => {
    nextResponse = () => jsonResponse({ data: {} });
    const { getInstanceOnboardingState } = await import("./instance-status");

    expect(await getInstanceOnboardingState()).toEqual({
      completed: true,
      hasUsers: true,
    });
  });
});
