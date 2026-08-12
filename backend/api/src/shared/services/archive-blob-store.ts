import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@almirant/config";
import { downloadBufferFromS3, isS3Configured, uploadBufferToS3 } from "./s3-service";

export type ArchiveBlobRef = {
  storageBucket: string | null;
  storageKey: string;
  storageUrl: string | null;
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

export const getArchiveBlob = async (ref: ArchiveBlobRef): Promise<Uint8Array> => {
  if (ref.storageBucket && isS3Configured(ref.storageBucket)) {
    return downloadBufferFromS3(ref.storageKey, ref.storageBucket);
  }

  return readFile(resolveLocalPath(ref.storageKey));
};
