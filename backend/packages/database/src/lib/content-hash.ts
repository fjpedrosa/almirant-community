import { createHash } from "crypto";

/**
 * Computes a deterministic SHA256 hex hash of the given content.
 *
 * Normalization rules:
 *  - Line endings `\r\n` are converted to `\n` before hashing.
 *  - The string is trimmed after line ending normalization.
 *
 * This helper is the single source of truth for content hashing used for
 * idempotency checks across skills, observations, work items, and other
 * entities that deduplicate by hash.
 */
export const computeContentHash = (content: string): string => {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized).digest("hex");
};

/**
 * Input shape accepted by `computeWorkItemContentHash`.
 * Only the fields that contribute to the hash are declared.
 */
export type WorkItemContentHashInput = {
  title: string;
  description?: string | null;
  type: string;
  parentId?: string | null;
  childIds?: string[];
};

/**
 * Computes a deterministic content hash for a work item.
 *
 * Fields are canonicalized EXPLICITLY (not via `JSON.stringify`) because
 * `JSON.stringify` is not deterministic for nested objects:
 *
 *   `${title}\n${description ?? ""}\n${type}\n${parentId ?? ""}\n${childIds.sorted.join(",")}`
 *
 * `childIds` are sorted ascending so the hash is independent of ordering.
 * The canonical string is then passed through `computeContentHash` which
 * normalizes line endings and trims before SHA256.
 *
 * The hash deliberately excludes tags, metadata, timestamps, and children's
 * content — only child IDs contribute.
 */
export const computeWorkItemContentHash = (
  workItem: WorkItemContentHashInput,
): string => {
  const title = workItem.title;
  const description = workItem.description ?? "";
  const type = workItem.type;
  const parentId = workItem.parentId ?? "";
  const childIdsJoined = (workItem.childIds ?? []).slice().sort().join(",");

  const canonical = `${title}\n${description}\n${type}\n${parentId}\n${childIdsJoined}`;

  return computeContentHash(canonical);
};
