import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

/**
 * Tests for `getEnabledAuthProviders`, the thin server-side client that reads
 * the social sign-in providers enabled on the BACKEND
 * (`GET /api/auth/providers`, via `authBackendFetch`).
 *
 * FAIL-SAFE: on any backend error/unreachable/malformed payload it returns all
 * providers as `false` so a transient blip never renders a social button that
 * cannot work — the email/password form always stays usable.
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

describe("getEnabledAuthProviders", () => {
  it("hits the backend providers endpoint", async () => {
    nextResponse = () =>
      jsonResponse({ success: true, data: { providers: [] } });
    const { getEnabledAuthProviders } = await import("./auth-providers");

    await getEnabledAuthProviders();

    expect(fetchCalls[0]).toContain("/api/auth/providers");
  });

  it("maps google + github ids from { success, data: { providers } }", async () => {
    nextResponse = () =>
      jsonResponse({
        success: true,
        data: {
          providers: [
            { id: "email-password", displayName: "Email", type: "credential" },
            { id: "google", displayName: "Google", type: "oauth" },
            { id: "github", displayName: "GitHub", type: "oauth" },
          ],
        },
      });
    const { getEnabledAuthProviders } = await import("./auth-providers");

    expect(await getEnabledAuthProviders()).toEqual({
      google: true,
      github: true,
    });
  });

  it("tolerates a bare { providers } object (no { data } wrapper)", async () => {
    nextResponse = () =>
      jsonResponse({
        providers: [{ id: "google" }],
      });
    const { getEnabledAuthProviders } = await import("./auth-providers");

    expect(await getEnabledAuthProviders()).toEqual({
      google: true,
      github: false,
    });
  });

  it("reports only the enabled provider (github disabled)", async () => {
    nextResponse = () =>
      jsonResponse({
        data: {
          providers: [
            { id: "email-password" },
            { id: "github" },
          ],
        },
      });
    const { getEnabledAuthProviders } = await import("./auth-providers");

    expect(await getEnabledAuthProviders()).toEqual({
      google: false,
      github: true,
    });
  });

  it("FAILS SAFE (all false) on a non-2xx backend response", async () => {
    nextResponse = () => new Response("boom", { status: 500 });
    const { getEnabledAuthProviders } = await import("./auth-providers");

    expect(await getEnabledAuthProviders()).toEqual({
      google: false,
      github: false,
    });
  });

  it("FAILS SAFE when the backend is unreachable (fetch throws)", async () => {
    fetchThrows = true;
    const { getEnabledAuthProviders } = await import("./auth-providers");

    expect(await getEnabledAuthProviders()).toEqual({
      google: false,
      github: false,
    });
  });

  it("FAILS SAFE when the payload is malformed (providers not an array)", async () => {
    nextResponse = () => jsonResponse({ data: { providers: "nope" } });
    const { getEnabledAuthProviders } = await import("./auth-providers");

    expect(await getEnabledAuthProviders()).toEqual({
      google: false,
      github: false,
    });
  });

  it("FAILS SAFE on a JSON null body", async () => {
    nextResponse = () => jsonResponse(null);
    const { getEnabledAuthProviders } = await import("./auth-providers");

    expect(await getEnabledAuthProviders()).toEqual({
      google: false,
      github: false,
    });
  });
});
