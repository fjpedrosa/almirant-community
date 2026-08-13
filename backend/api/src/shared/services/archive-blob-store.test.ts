import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  uploadFileToS3: async (
    _filePath: string,
    key: string,
    _contentType: string,
    bucket: string,
  ) => {
    s3Uploads.push({ key, bucket });
    return `https://s3.example/${bucket}/${key}`;
  },
  downloadBufferFromS3: async () => Buffer.from("from-s3"),
}));

const { isArchiveStoreConfigured, putArchiveBlob, putArchiveBlobFromFile, getArchiveBlob } = await import(
  "./archive-blob-store"
);

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

  test("copies a cross-device spool into same-directory archive storage", async () => {
    const spool = join(storageDir, "archive.part");
    writeFileSync(spool, Buffer.from([4, 5, 6]));
    const ref = await putArchiveBlobFromFile("agent-jobs/xyz/native_events.ndjson.gz", spool, "application/gzip");

    expect(ref.storageBucket).toBeNull();
    expect(readFileSync(join(storageDir, "archives", "agent-jobs", "xyz", "native_events.ndjson.gz"))).toEqual(
      Buffer.from([4, 5, 6]),
    );
    expect(() => readFileSync(spool)).toThrow();
  });

  test("preserves an existing archive key and cleans the source", async () => {
    const target = join(storageDir, "archives", "agent-jobs", "xyz", "native_events.ndjson.gz");
    mkdirSync(join(storageDir, "archives", "agent-jobs", "xyz"), { recursive: true });
    writeFileSync(target, Buffer.from("original"));
    const spool = join(storageDir, "archive.part");
    writeFileSync(spool, Buffer.from("replacement"));

    await expect(putArchiveBlobFromFile("agent-jobs/xyz/native_events.ndjson.gz", spool, "application/gzip")).rejects.toThrow();
    expect(readFileSync(target)).toEqual(Buffer.from("original"));
    expect(() => readFileSync(spool)).toThrow();
  });

  test("reuses an identical archive key after metadata retry", async () => {
    const body = Buffer.from("same");
    const target = join(storageDir, "archives", "agent-jobs", "xyz", "native_events.ndjson.gz");
    mkdirSync(join(storageDir, "archives", "agent-jobs", "xyz"), { recursive: true });
    writeFileSync(target, body);
    const spool = join(storageDir, "archive.part");
    writeFileSync(spool, body);
    await expect(putArchiveBlobFromFile("agent-jobs/xyz/native_events.ndjson.gz", spool, "application/gzip")).resolves.toBeTruthy();
    expect(readFileSync(target)).toEqual(body);
  });

  test("cleans a same-directory part when copying fails", async () => {
    const source = join(storageDir, "bad-source");
    mkdirSync(source);
    await expect(putArchiveBlobFromFile("agent-jobs/xyz/native_events.ndjson.gz", source, "application/gzip")).rejects.toThrow();
    expect(readdirSync(join(storageDir, "archives", "agent-jobs", "xyz"))).toEqual([]);
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

  test("streams a completed spool to S3 when configured", async () => {
    configuredBucket.value = "almirant-archives";
    const spool = join(storageDir, "archive.part");
    writeFileSync(spool, Buffer.from([1, 2]));
    const ref = await putArchiveBlobFromFile("agent-jobs/xyz/native_events.ndjson.gz", spool, "application/gzip");

    expect(ref.storageBucket).toBe("almirant-archives");
    expect(s3Uploads).toEqual([
      { key: "agent-jobs/xyz/native_events.ndjson.gz", bucket: "almirant-archives" },
    ]);
    expect(() => readFileSync(spool)).toThrow();
  });
});
