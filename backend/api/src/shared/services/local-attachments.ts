import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";

// Local fallback for attachments when S3 isn't configured.
// Kept in /tmp by default so it works in dev without extra setup.
const DEFAULT_LOCAL_ATTACHMENTS_ROOT = "/tmp/almirant/attachments";

export const getLocalAttachmentsRoot = (): string => {
  return process.env.MC_LOCAL_ATTACHMENTS_DIR || DEFAULT_LOCAL_ATTACHMENTS_ROOT;
};

const isSafeKey = (key: string): boolean => {
  if (!key) return false;
  if (key.includes("..")) return false;
  // Disallow absolute paths and backslashes.
  if (path.isAbsolute(key)) return false;
  if (key.includes("\\")) return false;
  return true;
};

export const resolveLocalAttachmentPath = (key: string): string => {
  if (!isSafeKey(key)) {
    throw new Error("Invalid attachment key");
  }
  const root = getLocalAttachmentsRoot();
  // Ensure `key` is always treated as relative.
  return path.join(root, key);
};

export const writeLocalAttachment = async (key: string, buffer: Uint8Array): Promise<void> => {
  const filePath = resolveLocalAttachmentPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, buffer);
};

export const deleteLocalAttachment = async (key: string): Promise<void> => {
  const filePath = resolveLocalAttachmentPath(key);
  await unlink(filePath);
};
