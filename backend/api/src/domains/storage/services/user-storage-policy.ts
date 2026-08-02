import { createHash } from "node:crypto";

export const DEFAULT_USER_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;
export const MAX_USER_STORAGE_PATH_LENGTH = 512;
export const MAX_USER_STORAGE_SEGMENT_LENGTH = 128;

export class StorageQuotaExceededError extends Error {
  readonly code = "USER_STORAGE_QUOTA_EXCEEDED";

  constructor(
    readonly quotaBytes: number,
    readonly usedBytes: number,
    readonly reservedBytes: number,
    readonly incomingBytes: number,
  ) {
    super(
      `Storage quota exceeded: ${incomingBytes} bytes requested with ${Math.max(
        quotaBytes - usedBytes - reservedBytes,
        0,
      )} bytes available`,
    );
    this.name = "StorageQuotaExceededError";
  }
}

const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

export const normalizeUserStoragePath = (rawPath: string): string => {
  const path = rawPath.trim();
  if (!path || path.length > MAX_USER_STORAGE_PATH_LENGTH) {
    throw new Error(`Storage path must be 1-${MAX_USER_STORAGE_PATH_LENGTH} characters`);
  }
  if (path.startsWith("/") || path.includes("\\") || CONTROL_CHARACTER_RE.test(path)) {
    throw new Error("Storage path must be a relative POSIX path without control characters");
  }

  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.length > MAX_USER_STORAGE_SEGMENT_LENGTH,
    )
  ) {
    throw new Error("Storage path contains an invalid segment");
  }

  return segments.join("/");
};

const sanitizeStorageFileName = (fileName: string): string => {
  const leaf = fileName.split("/").at(-1)?.trim() || "file";
  const sanitized = leaf
    .replace(CONTROL_CHARACTER_RE, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return sanitized || "file";
};

export const buildUserStorageObjectKey = ({
  ownerUserId,
  objectId,
  fileName,
}: {
  ownerUserId: string;
  objectId: string;
  fileName: string;
}): string => {
  const ownerHash = createHash("sha256").update(ownerUserId).digest("hex").slice(0, 32);
  return `user-storage/${ownerHash}/${objectId}/${sanitizeStorageFileName(fileName)}`;
};

export const reserveUserStorageBytes = ({
  quotaBytes,
  usedBytes,
  reservedBytes,
  incomingBytes,
}: {
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  incomingBytes: number;
}): { reservedBytes: number; availableBytes: number } => {
  for (const [name, value] of Object.entries({
    quotaBytes,
    usedBytes,
    reservedBytes,
    incomingBytes,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }

  if (usedBytes + reservedBytes + incomingBytes > quotaBytes) {
    throw new StorageQuotaExceededError(
      quotaBytes,
      usedBytes,
      reservedBytes,
      incomingBytes,
    );
  }

  const nextReservedBytes = reservedBytes + incomingBytes;
  return {
    reservedBytes: nextReservedBytes,
    availableBytes: quotaBytes - usedBytes - nextReservedBytes,
  };
};
