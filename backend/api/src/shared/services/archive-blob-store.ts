import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { env } from "@almirant/config";
import { downloadBufferFromS3, isS3Configured, uploadBufferToS3 } from "./s3-service";

export type ArchiveBlobRef = {
  storageBucket: string | null;
  storageKey: string;
  storageUrl: string | null;
};

export type StreamedArchiveBlob = ArchiveBlobRef & {
  checksumSha256: string;
  byteLength: number;
};

const ARCHIVE_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

const getArchiveBucket = (): string | null => env.S3_PRIVATE_BUCKET ?? env.S3_BUCKET ?? null;

const getLocalArchiveRoot = (): string =>
  path.resolve(
    process.env.ALMIRANT_STORAGE_DIR ?? path.join(process.cwd(), ".almirant-storage"),
    "archives",
  );

const resolveLocalPath = (key: string): string => {
  if (!ARCHIVE_KEY_RE.test(key) || key.includes("..")) {
    throw new Error(`Invalid archive key: ${key}`);
  }

  const root = getLocalArchiveRoot();
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Invalid archive key: ${key}`);
  }

  return resolved;
};

// Always true: without a bucket the store falls back to the local disk.
export const isArchiveStoreConfigured = (): boolean => true;

export const putArchiveBlob = async (
  key: string,
  body: Uint8Array,
): Promise<ArchiveBlobRef> => {
  const bucket = getArchiveBucket();
  if (bucket && isS3Configured(bucket)) {
    const storageUrl = await uploadBufferToS3(body, key, "application/gzip", bucket);
    return { storageBucket: bucket, storageKey: key, storageUrl };
  }

  const target = resolveLocalPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);

  return { storageBucket: null, storageKey: key, storageUrl: null };
};

/**
 * Gzips `lines` straight into storage. Only compressed chunks are held, so a
 * job with millions of events costs the same memory as one with ten.
 */
export const putArchiveBlobFromLines = async (
  key: string,
  lines: AsyncIterable<string>,
): Promise<StreamedArchiveBlob> => {
  const hash = createHash("sha256");
  let byteLength = 0;

  const measure = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      byteLength += chunk.length;
      callback(null, chunk);
    },
  });

  const bucket = getArchiveBucket();
  const useS3 = !!bucket && isS3Configured(bucket);

  const compressed: Buffer[] = [];
  const sink = useS3
    ? new Writable({
        write(chunk, _encoding, callback) {
          compressed.push(Buffer.from(chunk));
          callback();
        },
      })
    : await (async () => {
        const target = resolveLocalPath(key);
        await mkdir(path.dirname(target), { recursive: true });
        return createWriteStream(target);
      })();

  await pipeline(Readable.from(lines), createGzip(), measure, sink);

  if (useS3) {
    const storageUrl = await uploadBufferToS3(
      Buffer.concat(compressed),
      key,
      "application/gzip",
      bucket!,
    );
    return { storageBucket: bucket!, storageKey: key, storageUrl, checksumSha256: hash.digest("hex"), byteLength };
  }

  return {
    storageBucket: null,
    storageKey: key,
    storageUrl: null,
    checksumSha256: hash.digest("hex"),
    byteLength,
  };
};

export const getArchiveBlob = async (ref: ArchiveBlobRef): Promise<Uint8Array> => {
  if (ref.storageBucket && isS3Configured(ref.storageBucket)) {
    return downloadBufferFromS3(ref.storageKey, ref.storageBucket);
  }

  return readFile(resolveLocalPath(ref.storageKey));
};
