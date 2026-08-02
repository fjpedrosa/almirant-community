import { afterEach, describe, expect, it } from "bun:test";
import { userStorageApi } from "./user-storage-api";

const originalFetch = globalThis.fetch;

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("userStorageApi", () => {
  it("loads usage and files from the user-scoped storage endpoints", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);

      if (url.endsWith("/storage/usage")) {
        return jsonResponse({
          quotaBytes: 1_073_741_824,
          usedBytes: 128,
          reservedBytes: 0,
          quotaObjects: 10_000,
          usedObjects: 1,
          reservedObjects: 0,
          availableObjects: 9_999,
          updatedAt: "2026-07-10T10:00:00.000Z",
        });
      }

      return jsonResponse([
        {
          id: "file-1",
          virtualPath: "research/notes.txt",
          fileName: "notes.txt",
          contentType: "text/plain",
          sizeBytes: 128,
          kind: "file",
          createdAt: "2026-07-10T10:00:00.000Z",
          updatedAt: "2026-07-10T10:00:00.000Z",
        },
      ]);
    }) as typeof fetch;

    const [usage, files] = await Promise.all([
      userStorageApi.getUsage(),
      userStorageApi.listFiles(),
    ]);

    expect(usage.quotaBytes).toBe(1_073_741_824);
    expect(files[0]?.virtualPath).toBe("research/notes.txt");
    expect(requests.some((url) => url.endsWith("/storage/usage"))).toBe(true);
    expect(requests.some((url) => url.endsWith("/storage/files"))).toBe(true);
  });

  it("uploads multipart file + optional virtual path without forcing a content-type header", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return jsonResponse({
        id: "file-1",
        virtualPath: "research/notes.txt",
        fileName: "notes.txt",
        contentType: "text/plain",
        sizeBytes: 5,
        kind: "file",
        createdAt: "2026-07-10T10:00:00.000Z",
        updatedAt: "2026-07-10T10:00:00.000Z",
      });
    }) as typeof fetch;

    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    await userStorageApi.upload({ file, path: "research/notes.txt" });

    expect(requestUrl).toEndWith("/storage/files");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.credentials).toBe("include");
    expect(requestInit?.body).toBeInstanceOf(FormData);

    const formData = requestInit?.body as FormData;
    const uploadedFile = formData.get("file");
    expect(uploadedFile).toBeInstanceOf(File);
    expect((uploadedFile as File).name).toBe("notes.txt");
    expect(await (uploadedFile as File).text()).toBe("notes");
    expect(formData.get("path")).toBe("research/notes.txt");

    const headers = new Headers(requestInit?.headers);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("downloads and deletes files through encoded id endpoints", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (init?.method === "DELETE") {
        return jsonResponse({ deleted: true });
      }
      return new Response(new Blob(["file contents"], { type: "text/plain" }), {
        status: 200,
      });
    }) as typeof fetch;

    const blob = await userStorageApi.download("file id/1");
    const deleted = await userStorageApi.delete("file id/1");

    expect(await blob.text()).toBe("file contents");
    expect(deleted).toEqual({ deleted: true });
    expect(requests[0]?.url).toEndWith("/storage/files/file%20id%2F1");
    expect(requests[0]?.init?.credentials).toBe("include");
    expect(requests[1]?.url).toEndWith("/storage/files/file%20id%2F1");
    expect(requests[1]?.init?.method).toBe("DELETE");
  });

  it("rejects malformed storage payloads at the API boundary", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        quotaBytes: "one gigabyte",
        usedBytes: -1,
        reservedBytes: 0,
      })) as unknown as typeof fetch;

    await expect(userStorageApi.getUsage()).rejects.toThrow();
  });

  it("rejects unsafe virtual paths before uploading", async () => {
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return jsonResponse(null);
    }) as unknown as typeof fetch;

    await expect(
      userStorageApi.upload({
        file: new File(["secret"], "secret.txt"),
        path: "../secret.txt",
      }),
    ).rejects.toThrow("relative POSIX path");
    expect(requestCount).toBe(0);
  });
});
