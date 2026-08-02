import { describe, expect, it, mock } from "bun:test";
import {
  UserStorageUnavailableError,
  createS3UserStorageObjectStore,
} from "./user-storage-object-store";

describe("S3 user storage object store", () => {
  it("uses the configured private bucket and private cache semantics for every operation", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const bytes = new TextEncoder().encode("private data");
    const store = createS3UserStorageObjectStore({
      getPrivateBucket: () => "private-bucket",
      isConfigured: (bucket) => bucket === "private-bucket",
      upload: mock(async (payload, key, contentType, bucket, options) => {
        calls.push({ operation: "put", payload, key, contentType, bucket, options });
      }),
      download: mock(async (key, bucket) => {
        calls.push({ operation: "get", key, bucket });
        return bytes;
      }),
      remove: mock(async (key, bucket) => {
        calls.push({ operation: "delete", key, bucket });
      }),
    });

    await store.put({ key: "opaque/key", bytes, contentType: "text/plain" });
    expect(await store.get("opaque/key")).toEqual(bytes);
    await store.delete("opaque/key");

    expect(calls).toEqual([
      {
        operation: "put",
        payload: bytes,
        key: "opaque/key",
        contentType: "text/plain",
        bucket: "private-bucket",
        options: { cacheControl: "private, no-store" },
      },
      { operation: "get", key: "opaque/key", bucket: "private-bucket" },
      { operation: "delete", key: "opaque/key", bucket: "private-bucket" },
    ]);
  });

  it("fails closed when private object storage is not configured", async () => {
    const upload = mock(async () => undefined);
    const store = createS3UserStorageObjectStore({
      getPrivateBucket: () => null,
      isConfigured: () => false,
      upload,
      download: mock(async () => new Uint8Array()),
      remove: mock(async () => undefined),
    });

    await expect(
      store.put({
        key: "opaque/key",
        bytes: new Uint8Array([1]),
        contentType: "application/octet-stream",
      }),
    ).rejects.toBeInstanceOf(UserStorageUnavailableError);
    expect(upload).not.toHaveBeenCalled();
  });
});
