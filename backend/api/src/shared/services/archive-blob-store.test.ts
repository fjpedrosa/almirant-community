import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configuredBucket: { value: string | null } = { value: null };
const s3Uploads: Array<{ key: string; bucket: string }> = [];

mock.module("@almirant/config", () => ({
  env: {
    get S3_PRIVATE_BUCKET() {
      return configuredBucket.value ?? undefined;
    },
    get S3_BUCKET() {
      return undefined;
    },
  },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

mock.module("./s3-service", () => ({
  isS3Configured: (bucket?: string | null) => !!bucket,
  uploadBufferToS3: async (
    _body: Uint8Array,
    key: string,
    _contentType: string,
    bucket: string,
  ) => {
    s3Uploads.push({ key, bucket });
    return `https://s3.example/${bucket}/${key}`;
  },
  downloadBufferFromS3: async () => Buffer.from("from-s3"),
}));

const {
  isArchiveStoreConfigured,
  putArchiveBlob,
  putArchiveBlobFromLines,
  getArchiveBlob,
} = await import("./archive-blob-store");

let storageDir: string;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), "almirant-archive-test-"));
  process.env.ALMIRANT_STORAGE_DIR = storageDir;
  configuredBucket.value = null;
  s3Uploads.length = 0;
});

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
  delete process.env.ALMIRANT_STORAGE_DIR;
});

describe("archive blob store", () => {
  test("is configured without S3 because the local disk is always available", () => {
    expect(isArchiveStoreConfigured()).toBe(true);
  });

  test("writes to the local storage dir when S3 is absent", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const ref = await putArchiveBlob("planning-sessions/abc/native_events.ndjson.gz", body);

    expect(ref.storageBucket).toBeNull();
    expect(ref.storageKey).toBe("planning-sessions/abc/native_events.ndjson.gz");
    expect(s3Uploads).toHaveLength(0);

    const written = readFileSync(
      join(storageDir, "archives", "planning-sessions", "abc", "native_events.ndjson.gz"),
    );
    expect(new Uint8Array(written)).toEqual(body);
  });

  test("round-trips a blob through the local disk", async () => {
    const body = new Uint8Array([9, 8, 7]);
    const ref = await putArchiveBlob("agent-jobs/xyz/native_events.ndjson.gz", body);

    expect(new Uint8Array(await getArchiveBlob(ref))).toEqual(body);
  });

  test("refuses a key that escapes the storage root", async () => {
    await expect(putArchiveBlob("../../etc/passwd", new Uint8Array([0]))).rejects.toThrow(
      /Invalid archive key/,
    );
  });

  test("delegates to S3 when a bucket is configured", async () => {
    configuredBucket.value = "almirant-archives";

    const ref = await putArchiveBlob("agent-jobs/xyz/native_events.ndjson.gz", new Uint8Array([1]));

    expect(ref.storageBucket).toBe("almirant-archives");
    expect(s3Uploads).toEqual([
      { key: "agent-jobs/xyz/native_events.ndjson.gz", bucket: "almirant-archives" },
    ]);
  });
});

describe("streaming archive writes", () => {
  const lines = async function* (count: number) {
    for (let i = 0; i < count; i += 1) {
      yield `${JSON.stringify({ i, payload: "x".repeat(200) })}\n`;
    }
  };

  test("gzips a large stream to local disk without buffering the rows", async () => {
    const result = await putArchiveBlobFromLines(
      "agent-jobs/big/native_events.ndjson.gz",
      lines(50_000),
    );

    expect(result.storageBucket).toBeNull();
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.byteLength).toBeGreaterThan(0);

    const written = readFileSync(
      join(storageDir, "archives", "agent-jobs", "big", "native_events.ndjson.gz"),
    );
    expect(written.byteLength).toBe(result.byteLength);
  });

  test("round-trips the streamed content", async () => {
    const { gunzipSync } = await import("node:zlib");
    const ref = await putArchiveBlobFromLines("agent-jobs/rt/native_events.ndjson.gz", lines(3));
    const raw = gunzipSync(Buffer.from(await getArchiveBlob(ref))).toString("utf-8");

    expect(raw.trim().split("\n")).toHaveLength(3);
  });

  test("uploads the compressed stream to S3 when configured", async () => {
    configuredBucket.value = "almirant-archives";
    const result = await putArchiveBlobFromLines(
      "agent-jobs/s3/native_events.ndjson.gz",
      lines(10),
    );

    expect(result.storageBucket).toBe("almirant-archives");
    expect(s3Uploads).toHaveLength(1);
  });
});
