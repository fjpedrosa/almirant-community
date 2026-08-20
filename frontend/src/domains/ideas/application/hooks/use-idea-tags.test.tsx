import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const originalFetch = globalThis.fetch;
const originalAuthUrl = process.env.NEXT_PUBLIC_AUTH_URL;
let useAddIdeaTag: typeof import("./use-idea-tags").useAddIdeaTag;
let requests: Array<{ url: string; method: string; body: string }> = [];
const cases = [
  { name: "outer spaces", data: { name: "  new tag  " }, global: true },
  { name: "tagId only", data: { tagId: "tag-1" }, global: false },
  { name: "empty name", data: { name: "" }, global: false },
  { name: "whitespace name", data: { name: " \t " }, global: false },
  { name: "tagId and name", data: { tagId: "tag-1", name: "existing" }, global: true },
] as const;

const response = () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
const errorResponse = () => new Response(JSON.stringify({ success: false, error: "tag failed" }), { status: 400 });
const harness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
};
const keySequence = (spy: ReturnType<typeof spyOn>) => spy.mock.calls.map((call: unknown[]) => JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey));

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { requests.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") }); return response(); }) as unknown as typeof fetch;
});

beforeAll(async () => {
  process.env.NEXT_PUBLIC_AUTH_URL = "http://localhost:3000";
  ({ useAddIdeaTag } = await import("./use-idea-tags"));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  if (originalAuthUrl === undefined) delete process.env.NEXT_PUBLIC_AUTH_URL;
  else process.env.NEXT_PUBLIC_AUTH_URL = originalAuthUrl;
});

describe("useAddIdeaTag tag-list invalidation", () => {
  it("invalidates the complete entity-then-global sequence only for a non-empty name", async () => {
    for (const testCase of cases) {
      const { client, wrapper } = harness();
      const invalidate = spyOn(client, "invalidateQueries");
      const { result, unmount } = renderHook(() => useAddIdeaTag(), { wrapper });
      if (testCase.global) { client.setQueryData(["tags", "list", "org:a"], []); client.setQueryData(["tags", "list", "org:b"], []); client.setQueryData(["tags", "detail", "tag-1"], {}); }
      requests = [];

      await result.current.mutateAsync({ id: "idea-1", data: testCase.data });

      const expected = [["ideas", "list"], ["ideas", "detail", "idea-1"], ...(testCase.global ? [["tags", "list"]] : [])];
      expect(keySequence(invalidate)).toEqual(expected.map((key) => JSON.stringify(key)));
      if (testCase.global) { expect(requests).toEqual([{ url: "/api/ideas/items/idea-1/tags", method: "POST", body: JSON.stringify(testCase.data) }]); expect(client.getQueryState(["tags", "list", "org:a"])?.isInvalidated).toBe(true); expect(client.getQueryState(["tags", "list", "org:b"])?.isInvalidated).toBe(true); expect(client.getQueryState(["tags", "detail", "tag-1"])?.isInvalidated).toBe(false); }
      unmount(); client.clear();
    }
  });

  it("waits for a successful response and does not invalidate on errors", async () => {
    let resolveResponse!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    globalThis.fetch = (async () => pending) as unknown as typeof fetch;
    const { client, wrapper } = harness(); const invalidate = spyOn(client, "invalidateQueries"); const { result, unmount } = renderHook(() => useAddIdeaTag(), { wrapper });
    let mutation!: Promise<unknown>; await act(async () => { mutation = result.current.mutateAsync({ id: "idea-1", data: { name: "new" } }); await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(invalidate).not.toHaveBeenCalled(); await act(async () => { resolveResponse(response()); await mutation; }); expect(keySequence(invalidate)).toEqual([["ideas", "list"], ["ideas", "detail", "idea-1"], ["tags", "list"]].map((key) => JSON.stringify(key))); invalidate.mockClear(); globalThis.fetch = (async () => response()) as unknown as typeof fetch; await act(async () => { await result.current.mutateAsync({ id: "idea-1", data: { tagId: "tag-2" } }); }); expect(keySequence(invalidate)).toEqual([["ideas", "list"], ["ideas", "detail", "idea-1"]].map((key) => JSON.stringify(key))); unmount(); client.clear();

    globalThis.fetch = (async () => errorResponse()) as unknown as typeof fetch;
    const failedHarness = harness(); const failedInvalidate = spyOn(failedHarness.client, "invalidateQueries"); const failed = renderHook(() => useAddIdeaTag(), { wrapper: failedHarness.wrapper });
    await expect(failed.result.current.mutateAsync({ id: "idea-1", data: { name: "new" } })).rejects.toThrow(); expect(failedInvalidate).not.toHaveBeenCalled(); failed.unmount(); failedHarness.client.clear();
  });
});
