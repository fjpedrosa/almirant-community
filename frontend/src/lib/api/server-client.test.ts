import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

/**
 * S6 guardrail: the SSR work-items prefetch is only useful if it hits the SAME
 * backend route the client `workItemsApi.getByArea` uses. A typo in the path
 * would silently 404 → prefetch discarded → client refetches the ~550KB board.
 * This pins `workItemsServerApi.getByArea(area)` to `/boards/area/<area>/work-items`.
 *
 * `server-client.ts` imports `next/headers` (throws outside a request scope) and
 * calls `fetch`, so we stub both before dynamically importing the module.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchCalls: Array<{ url: string; init: any }> = [];

const stubOkResponse = () =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ success: true, data: [] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

beforeEach(() => {
  fetchCalls = [];
  mock.module("next/headers", () => ({
    // No token → no Authorization header; irrelevant to the URL assertion.
    cookies: async () => ({ get: () => undefined }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = ((url: any, init: any) => {
    fetchCalls.push({ url: String(url), init });
    return Promise.resolve(stubOkResponse());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
});

afterEach(() => {
  mock.restore();
});

describe("workItemsServerApi.getByArea", () => {
  it("targets the same /boards/area/<area>/work-items route as the client, opting into the slim board view", async () => {
    const { workItemsServerApi } = await import("./server-client");

    await workItemsServerApi.getByArea("desarrollo");

    expect(fetchCalls).toHaveLength(1);
    // Must request the SAME slim `?view=board` DTO the client hook uses, so the
    // dehydrated cache hydrates (same shape) instead of a client refetch.
    expect(fetchCalls[0].url).toEndWith(
      "/api/boards/area/desarrollo/work-items?view=board",
    );
    // RSC prefetch must not be served from Next's data cache.
    expect(fetchCalls[0].init?.cache).toBe("no-store");
  });

  it("url-encodes the area segment", async () => {
    const { workItemsServerApi } = await import("./server-client");

    await workItemsServerApi.getByArea("a/b");

    expect(fetchCalls[0].url).toEndWith(
      "/api/boards/area/a%2Fb/work-items?view=board",
    );
  });
});

describe("planningServerApi.getSession", () => {
  it("targets /planning-sessions/<id> (same route as the client hook)", async () => {
    const { planningServerApi } = await import("./server-client");

    await planningServerApi.getSession("sess-1");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toEndWith("/api/planning-sessions/sess-1");
    expect(fetchCalls[0].init?.cache).toBe("no-store");
  });
});

describe("planningServerApi.getLatestOutput", () => {
  it("targets /planning-sessions/<id>/latest-output (same route as the client hook)", async () => {
    const { planningServerApi } = await import("./server-client");

    await planningServerApi.getLatestOutput("sess-1");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toEndWith(
      "/api/planning-sessions/sess-1/latest-output?limit=1000",
    );
    expect(fetchCalls[0].init?.cache).toBe("no-store");
  });
});

describe("agentJobsServerApi", () => {
  it("listBySession asks for the single latest job of the session", async () => {
    const { agentJobsServerApi } = await import("./server-client");

    await agentJobsServerApi.listBySession("sess-1");

    expect(fetchCalls[0].url).toEndWith(
      "/api/agent-jobs?planningSessionId=sess-1&limit=1&sort=createdAt:desc",
    );
  });

  it("getOutput asks for the job transcript chunks", async () => {
    const { agentJobsServerApi } = await import("./server-client");

    await agentJobsServerApi.getOutput("job-9");

    expect(fetchCalls[0].url).toEndWith("/api/agent-jobs/job-9/output?limit=1000");
  });
});
