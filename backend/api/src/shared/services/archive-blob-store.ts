import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@almirant/config";
import {
  downloadBufferFromS3,
  isS3Configured,
  uploadBufferToS3,
  uploadFileToS3,
} from "./s3-service";

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

const sameFile = async (left: string, right: string): Promise<boolean> => {
  const [a, b] = await Promise.all([stat(left), stat(right)]);
  if (a.size !== b.size) return false;
  const digest = async (file: string) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  };
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]);
  return leftHash === rightHash;
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

export const putArchiveBlobFromFile = async (
  key: string,
  filePath: string,
  contentType: string,
): Promise<ArchiveBlobRef> => {
  const bucket = getArchiveBucket();
  if (bucket && isS3Configured(bucket)) {
    const storageUrl = await uploadFileToS3(filePath, key, contentType, bucket);
    await rm(filePath, { force: true });
    return { storageBucket: bucket, storageKey: key, storageUrl };
  }

  const target = resolveLocalPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  const part = `${target}.${randomUUID()}.part`;
  try {
    await copyFile(filePath, part);
    await chmod(part, 0o600);
    try {
      await link(part, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await sameFile(part, target))) {
        throw error;
      }
    }
    return { storageBucket: null, storageKey: key, storageUrl: null };
  } finally {
    await Promise.all([
      rm(part, { force: true }),
      rm(filePath, { force: true }),
    ]);
  }
};

export const getArchiveBlob = async (ref: ArchiveBlobRef): Promise<Uint8Array> => {
  if (ref.storageBucket && isS3Configured(ref.storageBucket)) {
    return downloadBufferFromS3(ref.storageKey, ref.storageBucket);
  }

  return readFile(resolveLocalPath(ref.storageKey));
};
