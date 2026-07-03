import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

/**
 * Characterization tests for the already-refactored thin server-session client.
 *
 * `server-session.ts` computes `AUTH_BASE` (via `resolveBackendOrigin()`) at
 * MODULE LOAD. To exercise the precedence rules we set env FIRST, then load a
 * FRESH copy of the module (query-string cache-bust) so the module-level const
 * is re-evaluated under the current env.
 *
 * `mock.module()` is PROCESS-GLOBAL and `mock.restore()` does NOT clear it, so
 * we capture the real `next/headers` module up front and restore it in
 * `afterAll` to avoid leaking into sibling test files.
 */

// Capture the real module BEFORE registering the mock (leak-safety).
let realNextHeaders: unknown = {};
try {
  realNextHeaders = await import("next/headers");
} catch {
  realNextHeaders = {};
}

// Mutable state the mocked `next/headers` reads at call time.
let currentCookie = "session=abc";
let cookiesThrows = false;
let cookieSetCalls: unknown[][] = [];
const cookieStore = {
  set: (...args: unknown[]) => {
    cookieSetCalls.push(args);
  },
};

mock.module("next/headers", () => ({
  headers: async () =>
    new Headers(currentCookie ? { cookie: currentCookie } : {}),
  cookies: async () => {
    if (cookiesThrows) throw new Error("cookie mutation disallowed (RSC render)");
    return cookieStore;
  },
}));

const realFetch = globalThis.fetch;

// Records every fetch invocation so tests can assert URL/init.
let fetchCalls: { url: string; init?: RequestInit }[] = [];
// The Response the next fetch call resolves to; overridable per test.
let nextResponse: () => Response = () =>
  new Response(
    JSON.stringify({
      session: {
        id: "s1",
        token: "t1",
        userId: "u1",
        expiresAt: "2030-01-01T00:00:00.000Z",
        activeOrganizationId: null,
      },
      user: {
        id: "u1",
        email: "a@b.c",
        name: "A",
        role: "member",
        locale: "en",
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
let fetchThrows = false;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls.push({ url: String(input), init });
  if (fetchThrows) throw new Error("network down");
  return nextResponse();
}) as typeof fetch;

// Fresh module loader (bust the ESM cache so AUTH_BASE re-evaluates).
let seq = 0;
const freshModule = async (): Promise<typeof import("./server-session")> => {
  seq += 1;
  return import(`./server-session.ts?cb=${seq}`);
};

beforeEach(() => {
  currentCookie = "session=abc";
  cookiesThrows = false;
  cookieSetCalls = [];
  fetchCalls = [];
  fetchThrows = false;
  delete process.env.BACKEND_URL;
  delete process.env.NEXT_PUBLIC_AUTH_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  delete process.env.BACKEND_URL;
  delete process.env.NEXT_PUBLIC_AUTH_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterAll(() => {
  mock.module("next/headers", () => realNextHeaders);
  globalThis.fetch = realFetch;
});

describe("resolveBackendOrigin precedence (via AUTH_BASE)", () => {
  it("prefers BACKEND_URL over every other source", async () => {
    process.env.BACKEND_URL = "https://backend.internal";
    process.env.NEXT_PUBLIC_AUTH_URL = "https://auth.almirant.ai";
    process.env.NEXT_PUBLIC_API_URL = "https://api.almirant.ai/api";

    const { getServerSession } = await freshModule();
    await getServerSession();

    expect(fetchCalls[0]?.url).toBe(
      "https://backend.internal/api/auth/get-session",
    );
  });

  it("strips a trailing slash from BACKEND_URL", async () => {
    process.env.BACKEND_URL = "https://backend.internal/";

    const { getServerSession } = await freshModule();
    await getServerSession();

    expect(fetchCalls[0]?.url).toBe(
      "https://backend.internal/api/auth/get-session",
    );
  });

  it("falls back to NEXT_PUBLIC_AUTH_URL when BACKEND_URL is unset", async () => {
    process.env.NEXT_PUBLIC_AUTH_URL = "https://auth.almirant.ai";
    process.env.NEXT_PUBLIC_API_URL = "https://api.almirant.ai/api";

    const { getServerSession } = await freshModule();
    await getServerSession();

    expect(fetchCalls[0]?.url).toBe(
      "https://auth.almirant.ai/api/auth/get-session",
    );
  });

  it("ignores a relative NEXT_PUBLIC_AUTH_URL and falls through", async () => {
    process.env.NEXT_PUBLIC_AUTH_URL = "/api";
    process.env.NEXT_PUBLIC_API_URL = "https://api.almirant.ai/api";

    const { getServerSession } = await freshModule();
    await getServerSession();

    expect(fetchCalls[0]?.url).toBe(
      "https://api.almirant.ai/api/auth/get-session",
    );
  });

  it("derives origin from NEXT_PUBLIC_API_URL by stripping a trailing /api", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.almirant.ai/api";

    const { getServerSession } = await freshModule();
    await getServerSession();

    expect(fetchCalls[0]?.url).toBe(
      "https://api.almirant.ai/api/auth/get-session",
    );
  });

  it("falls back to the localhost dev default when nothing is configured", async () => {
    const { getServerSession } = await freshModule();
    await getServerSession();

    expect(fetchCalls[0]?.url).toBe(
      "http://localhost:3001/api/auth/get-session",
    );
  });
});

describe("getServerSession", () => {
  it("forwards the incoming Cookie header with cache:no-store", async () => {
    currentCookie = "session=xyz";
    const { getServerSession } = await freshModule();

    await getServerSession();

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe(
      "http://localhost:3001/api/auth/get-session",
    );
    expect(fetchCalls[0]?.init?.cache).toBe("no-store");
    expect(
      (fetchCalls[0]?.init?.headers as Record<string, string>).cookie,
    ).toBe("session=xyz");
  });

  it("returns the parsed session on a 2xx response", async () => {
    const { getServerSession } = await freshModule();

    const session = await getServerSession();

    expect(session?.session.id).toBe("s1");
    expect(session?.user.email).toBe("a@b.c");
    expect(session?.user.role).toBe("member");
  });

  it("returns null on a non-2xx response", async () => {
    nextResponse = () => new Response("nope", { status: 500 });
    const { getServerSession } = await freshModule();

    expect(await getServerSession()).toBeNull();

    // reset for later tests
    nextResponse = () =>
      new Response(
        JSON.stringify({
          session: {
            id: "s1",
            token: "t1",
            userId: "u1",
            expiresAt: "2030-01-01T00:00:00.000Z",
            activeOrganizationId: null,
          },
          user: {
            id: "u1",
            email: "a@b.c",
            name: "A",
            role: "member",
            locale: "en",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
  });

  it("returns null (and skips the round trip) when there is no cookie", async () => {
    currentCookie = "";
    const { getServerSession } = await freshModule();

    expect(await getServerSession()).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns null when the backend body is JSON null", async () => {
    nextResponse = () =>
      new Response("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const { getServerSession } = await freshModule();

    expect(await getServerSession()).toBeNull();
  });

  it("returns null when the fetch throws (network failure)", async () => {
    fetchThrows = true;
    const { getServerSession } = await freshModule();

    expect(await getServerSession()).toBeNull();
  });
});

describe("forwardSetCookies", () => {
  it("does nothing when the response has no Set-Cookie header", async () => {
    const { forwardSetCookies } = await freshModule();

    await forwardSetCookies(new Response(null, { status: 200 }));

    expect(cookieSetCalls).toHaveLength(0);
  });

  it("parses a Set-Cookie header and writes it to the cookie store", async () => {
    const { forwardSetCookies } = await freshModule();

    const response = new Response(null, {
      headers: [
        [
          "set-cookie",
          "session=abc; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax",
        ],
      ] as [string, string][],
    });

    await forwardSetCookies(response);

    expect(cookieSetCalls).toHaveLength(1);
    const [name, value, options] = cookieSetCalls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe("session");
    expect(value).toBe("abc");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBe(3600);
    expect(options.httpOnly).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.sameSite).toBe("lax");
  });

  it("swallows errors when the cookie store cannot be mutated (RSC render)", async () => {
    cookiesThrows = true;
    const { forwardSetCookies } = await freshModule();

    const response = new Response(null, {
      headers: [["set-cookie", "session=abc; Path=/"]] as [string, string][],
    });

    // Must not throw.
    await forwardSetCookies(response);
    expect(cookieSetCalls).toHaveLength(0);
  });
});
