import { createHash } from "node:crypto";

/**
 * Generates a SHA-256 hex hash of document content.
 * Returns a 64-character lowercase hex string.
 */
export const hashDocumentContent = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

