import React from "react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  userStorageKeys,
  useDeleteUserStorageFile,
  useDownloadUserStorageFile,
  useUploadUserStorageFile,
  useUserStorageFiles,
  useUserStorageUsage,
} from "./use-user-storage";

const usage = {
  quotaBytes: 1_073_741_824,
  usedBytes: 128,
  reservedBytes: 0,
  quotaObjects: 10_000,
  usedObjects: 1,
  reservedObjects: 0,
  availableObjects: 9_999,
  updatedAt: "2026-07-10T10:00:00.000Z",
};

const file = {
  id: "file-1",
  virtualPath: "research/notes.txt",
  fileName: "notes.txt",
  contentType: "text/plain",
  sizeBytes: 128,
  kind: "file" as const,
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T10:00:00.000Z",
};

const originalFetch = globalThis.fetch;
let requests: Array<{ url: string; method: string }> = [];

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });

    if (url.endsWith("/storage/usage")) return jsonResponse(usage);
    if (method === "POST") return jsonResponse(file);
    if (method === "DELETE") return jsonResponse({ deleted: true });
    if (url.endsWith("/storage/files/file-1")) {
      return new Response(new Blob(["notes"]), { status: 200 });
    }
    return jsonResponse([file]);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const createHarness = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

describe("user storage hooks", () => {
  it("loads user usage and files without a workspace gate", async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => ({
        usage: useUserStorageUsage(),
        files: useUserStorageFiles(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.usage.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.files.isSuccess).toBe(true));

    expect(
      requests.filter(({ url }) => url.endsWith("/storage/usage")),
    ).toHaveLength(1);
    expect(
      requests.filter(({ url }) => url.endsWith("/storage/files")),
    ).toHaveLength(1);
  });

  it("invalidates usage and files after an upload", async () => {
    const { client, wrapper } = createHarness();
    client.setQueryData(userStorageKeys.usage(), usage);
    client.setQueryData(userStorageKeys.files(), [file]);
    const invalidateQueries = mock(client.invalidateQueries.bind(client));
    client.invalidateQueries = invalidateQueries;

    const { result } = renderHook(() => useUploadUserStorageFile(), {
      wrapper,
    });
    const input = {
      file: new File(["notes"], "notes.txt", { type: "text/plain" }),
      path: "research/notes.txt",
    };

    await result.current.mutateAsync(input);

    expect(requests).toContainEqual({ url: "/api/storage/files", method: "POST" });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: userStorageKeys.all,
    });
  });

  it("invalidates storage state after delete and delegates downloads", async () => {
    const { client, wrapper } = createHarness();
    const invalidateQueries = mock(client.invalidateQueries.bind(client));
    client.invalidateQueries = invalidateQueries;

    const { result } = renderHook(
      () => ({
        remove: useDeleteUserStorageFile(),
        download: useDownloadUserStorageFile(),
      }),
      { wrapper },
    );

    await result.current.remove.mutateAsync("file-1");
    const blob = await result.current.download.mutateAsync("file-1");

    expect(requests).toContainEqual({
      url: "/api/storage/files/file-1",
      method: "DELETE",
    });
    expect(requests).toContainEqual({
      url: "/api/storage/files/file-1",
      method: "GET",
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: userStorageKeys.all,
    });
  });
});
