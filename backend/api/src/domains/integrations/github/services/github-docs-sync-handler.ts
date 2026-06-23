import { createHash } from "crypto";
import {
  getProjectIdByRepoId,
  getOrganizationIdByRepoId,
  getDocsPathByRepoId,
  getGithubInstallationIdByRepoFullName,
  getDocumentByFilePath,
  createSyncedDocument,
  updateSyncedDocument,
  archiveDocument,
  unarchiveDocument,
  createDocumentVersion,
  getDocumentCategoryByNameAndParent,
  createDocumentCategory,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { fetchFromGithub } from "./github-service";
import { deleteFromS3, isS3Configured, uploadBufferToS3 } from "../../../../shared/services/s3-service";
import { uploadDocument } from "../../../documents/services/document-storage";

// ---- Types ----

interface PushCommit {
  id: string; // SHA
  added: string[];
  modified: string[];
  removed: string[];
  timestamp: string;
  message: string;
  author?: {
    username?: string;
    name?: string;
  };
}

interface GithubFileContentResponse {
  type: "file";
  encoding: "base64";
  size: number;
  name: string;
  path: string;
  content: string;
  sha: string;
}

interface DocSyncResult {
  created: number;
  updated: number;
  archived: number;
  skipped: number;
  errors: number;
}

// ---- Constants ----

const DEFAULT_DOCS_PREFIX = "docs/";

// Supported file extensions for documentation sync
const SUPPORTED_EXTENSIONS = [".md", ".mdx", ".txt", ".rst", ".adoc"];

// Supported asset extensions for docs (images, etc.)
const ASSET_MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

// ---- Helpers ----

/**
 * Normalize a docs prefix for case-insensitive matching.
 * GitHub file paths preserve the original casing from the repo, so we need
 * to compare lowercased versions for reliable matching.
 */
const matchesDocsPrefix = (filePath: string, docsPath: string): boolean => {
  return filePath.toLowerCase().startsWith(docsPath.toLowerCase());
};

/**
 * Check if a file path is under the docs directory and has a supported extension.
 */
const isDocFile = (filePath: string, docsPath: string): boolean => {
  if (!matchesDocsPrefix(filePath, docsPath)) return false;
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
};

/**
 * Check if a file path is under docs and looks like a binary asset we can store in S3.
 */
const isDocAssetFile = (filePath: string, docsPath: string): boolean => {
  if (!matchesDocsPrefix(filePath, docsPath)) return false;
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return Boolean(ASSET_MIME_TYPES[ext]);
};

/**
 * Convert a repo file path like "Docs Internal/assets/cli-init.svg" to
 * a S3 asset path like "assets/cli-init.svg".
 */
const toAssetPath = (filePath: string, docsPath: string): string => {
  return matchesDocsPrefix(filePath, docsPath) ? filePath.slice(docsPath.length) : filePath;
};

const getAssetMimeType = (filePath: string): string => {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return ASSET_MIME_TYPES[ext] || "application/octet-stream";
};

/**
 * Derive a human-readable title from a file path.
 * Only uses the filename (last segment), not the folder path.
 * e.g. "Docs Internal/business/roadmap.md" -> "Roadmap"
 */
const titleFromFilePath = (filePath: string, docsPath: string): string => {
  const withoutPrefix = matchesDocsPrefix(filePath, docsPath)
    ? filePath.slice(docsPath.length)
    : filePath;
  // Remove file extension
  const withoutExt = withoutPrefix.replace(/\.[^.]+$/, "");
  // Use only the filename (last segment) — folder structure maps to categories
  const fileName = withoutExt.split("/").pop() || withoutExt;
  return fileName
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Compute SHA-256 hash of content for change detection.
 */
const computeContentHash = (content: string): string => {
  return createHash("sha256").update(content, "utf-8").digest("hex");
};

/**
 * Resolve or create a document category hierarchy from a file's folder structure.
 * e.g. "Docs Internal/business/roadmap.md" with docsPath="Docs Internal/"
 *   -> creates category "Business" and returns its ID.
 * e.g. "Docs Internal/business/q1/goals.md" -> creates "Business" then "Q1" under it.
 * Files in the "assets" folder are skipped (returns null).
 * Files at the root of docsPath (no subfolder) return null.
 */
export const resolveOrCreateCategoryForPath = async (
  organizationId: string,
  filePath: string,
  docsPath: string
): Promise<string | null> => {
  const relativePath = matchesDocsPrefix(filePath, docsPath)
    ? filePath.slice(docsPath.length)
    : filePath;
  const segments = relativePath.split("/");

  // File at root of docs folder (no subfolder) — no category
  if (segments.length <= 1) return null;

  // Skip "assets" folder — it contains images, not docs
  if (segments[0]!.toLowerCase() === "assets") return null;

  // Walk folder segments (excluding filename) and create/get categories hierarchically
  let parentId: string | null = null;
  for (let i = 0; i < segments.length - 1; i++) {
    const folderName = segments[i]!
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const existing = await getDocumentCategoryByNameAndParent(organizationId, folderName, parentId);
    if (existing) {
      parentId = existing.id;
    } else {
      const created = await createDocumentCategory(organizationId, {
        name: folderName,
        parentId: parentId || undefined,
      });
      if (!created) throw new Error(`Failed to create document category: ${folderName}`);
      parentId = created.id;
    }
  }

  return parentId;
};

// ---- Main handler ----

/**
 * Processes doc file changes from a GitHub push event.
 *
 * For each commit in the push:
 * - Files added under docs/ -> create new document + version
 * - Files modified under docs/ -> update document + create version (only if content changed)
 * - Files removed under docs/ -> archive document (soft delete via archivedAt)
 *
 * Errors per file are caught individually so one failure does not block the rest.
 */
export const handleDocSync = async (
  repoFullName: string,
  repoId: string,
  commits: PushCommit[],
  headCommitSha: string | null,
  deliveryId: string
): Promise<void> => {
  const logCtx = { repoFullName, deliveryId };

  // ---- Resolve projectId ----
  const projectId = await getProjectIdByRepoId(repoId);
  if (!projectId) {
    logger.warn(
      { ...logCtx, repoId },
      "[docs-sync] Could not resolve projectId from repoId, skipping doc sync"
    );
    return;
  }

  // ---- Resolve organizationId ----
  const organizationId = await getOrganizationIdByRepoId(repoId);
  if (!organizationId) {
    logger.warn(
      { ...logCtx, repoId },
      "[docs-sync] Could not resolve organizationId from repoId, skipping doc sync"
    );
    return;
  }

  // ---- Resolve GitHub installation ID (needed for API calls) ----
  const installationId = await getGithubInstallationIdByRepoFullName(repoFullName);
  if (!installationId) {
    logger.warn(
      logCtx,
      "[docs-sync] Could not resolve GitHub installation ID, skipping doc sync"
    );
    return;
  }

  // ---- Resolve docs path (dynamic per-repo, fallback to "docs/") ----
  const docsPath = (await getDocsPathByRepoId(repoId)) || DEFAULT_DOCS_PREFIX;
  logger.info({ ...logCtx, docsPath }, "[docs-sync] Using docs path");

  // ---- Deduplicate file paths across all commits ----
  // A file could appear in multiple commits within a single push. We take the
  // final state: if it was removed last, it is "removed". If it was added or
  // modified last, it is "upsert". Order matters -- later commits override.
  const fileActions = new Map<string, "upsert" | "removed">();

  for (const commit of commits) {
    for (const filePath of commit.added) {
      if (isDocFile(filePath, docsPath)) fileActions.set(filePath, "upsert");
    }
    for (const filePath of commit.modified) {
      if (isDocFile(filePath, docsPath)) fileActions.set(filePath, "upsert");
    }
    for (const filePath of commit.removed) {
      if (isDocFile(filePath, docsPath)) fileActions.set(filePath, "removed");
    }
  }

  if (fileActions.size === 0) {
    logger.debug(logCtx, "[docs-sync] No doc files changed in this push");
    // Note: asset sync is still useful even when no .md files changed.
  }

  if (fileActions.size > 0) {
    logger.info(
      { ...logCtx, fileCount: fileActions.size },
      "[docs-sync] Processing doc file changes"
    );
  }

  const result: DocSyncResult = {
    created: 0,
    updated: 0,
    archived: 0,
    skipped: 0,
    errors: 0,
  };

  // The ref to fetch file content from. Use the head commit SHA so we get the
  // exact state after the push, not a potentially stale branch HEAD.
  const ref = headCommitSha || "HEAD";

  // ---- Process each file ----
  for (const [filePath, action] of fileActions) {
    try {
      if (action === "removed") {
        await handleRemovedFile(organizationId, filePath, projectId, logCtx);
        result.archived++;
      } else {
        const outcome = await handleUpsertFile(
          organizationId,
          filePath,
          projectId,
          repoFullName,
          installationId,
          ref,
          docsPath,
          logCtx
        );
        if (outcome === "created") result.created++;
        else if (outcome === "updated") result.updated++;
        else result.skipped++;
      }
    } catch (error) {
      result.errors++;
      logger.error(
        {
          ...logCtx,
          filePath,
          action,
          error: error instanceof Error ? error.message : String(error),
        },
        "[docs-sync] Error processing file"
      );
    }
  }

  logger.info(
    { ...logCtx, ...result },
    "[docs-sync] Doc sync completed"
  );

  // ---- Sync docs assets to S3 (images) ----
  if (!isS3Configured()) {
    logger.warn(logCtx, "[docs-sync] S3 is not configured, skipping docs asset sync");
    return;
  }

  const assetActions = new Map<string, "upsert" | "removed">();
  for (const commit of commits) {
    for (const filePath of commit.added) {
      if (isDocAssetFile(filePath, docsPath)) assetActions.set(filePath, "upsert");
    }
    for (const filePath of commit.modified) {
      if (isDocAssetFile(filePath, docsPath)) assetActions.set(filePath, "upsert");
    }
    for (const filePath of commit.removed) {
      if (isDocAssetFile(filePath, docsPath)) assetActions.set(filePath, "removed");
    }
  }

  if (assetActions.size === 0) {
    logger.debug(logCtx, "[docs-sync] No docs assets changed in this push");
    return;
  }

  logger.info(
    { ...logCtx, assetCount: assetActions.size },
    "[docs-sync] Processing docs asset changes"
  );

  const [owner, repo] = repoFullName.split("/");

  for (const [filePath, action] of assetActions) {
    const assetPath = toAssetPath(filePath, docsPath);
    const primaryKey = `doc-assets/${projectId}/${assetPath}`;
    const legacyKey = `doc-assets/${projectId}/${DEFAULT_DOCS_PREFIX}${assetPath}`;

    try {
      if (action === "removed") {
        // Best-effort delete of known key variants.
        await Promise.allSettled([deleteFromS3(primaryKey), deleteFromS3(legacyKey)]);
        logger.info({ ...logCtx, filePath, s3Key: primaryKey }, "[docs-sync] Deleted docs asset from S3");
        continue;
      }

      const apiPath = `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${ref}`;
      const fileData = await fetchFromGithub<GithubFileContentResponse>(installationId, apiPath);

      if (fileData.type !== "file") {
        logger.warn(
          { ...logCtx, filePath, type: fileData.type },
          "[docs-sync] Asset path is not a file, skipping"
        );
        continue;
      }

      const buffer = Buffer.from(fileData.content, "base64");
      const contentType = getAssetMimeType(filePath);

      await uploadBufferToS3(buffer, primaryKey, contentType);
      logger.info({ ...logCtx, filePath, s3Key: primaryKey }, "[docs-sync] Uploaded docs asset to S3");
    } catch (error) {
      logger.error(
        { ...logCtx, filePath, action, error: error instanceof Error ? error.message : String(error) },
        "[docs-sync] Error syncing docs asset"
      );
    }
  }
};

// ---- Per-file handlers ----

const handleRemovedFile = async (
  organizationId: string,
  filePath: string,
  projectId: string,
  logCtx: Record<string, unknown>
): Promise<void> => {
  const existing = await getDocumentByFilePath(organizationId, filePath, projectId);
  if (!existing) {
    logger.debug(
      { ...logCtx, filePath },
      "[docs-sync] Removed file not found in DB, nothing to archive"
    );
    return;
  }

  await archiveDocument(organizationId, existing.id);
  logger.info(
    { ...logCtx, filePath, documentId: existing.id },
    "[docs-sync] Archived document"
  );
};

const handleUpsertFile = async (
  organizationId: string,
  filePath: string,
  projectId: string,
  repoFullName: string,
  installationId: number,
  ref: string,
  docsPath: string,
  logCtx: Record<string, unknown>
): Promise<"created" | "updated" | "skipped"> => {
  // ---- Fetch file content from GitHub ----
  const [owner, repo] = repoFullName.split("/");
  const apiPath = `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${ref}`;

  const fileData = await fetchFromGithub<GithubFileContentResponse>(
    installationId,
    apiPath
  );

  if (fileData.type !== "file") {
    logger.warn(
      { ...logCtx, filePath, type: fileData.type },
      "[docs-sync] Path is not a file, skipping"
    );
    return "skipped";
  }

  // Decode base64 content
  const content = Buffer.from(fileData.content, "base64").toString("utf-8");
  const contentHash = computeContentHash(content);
  const title = titleFromFilePath(filePath, docsPath);

  // Use versioned S3 key (content-addressed) instead of overwriting
  const s3Key = isS3Configured()
    ? await uploadDocument(projectId, filePath, content, contentHash)
    : `docs-sync/${projectId}/${filePath}`;

  // ---- Resolve category from folder structure ----
  const categoryId = await resolveOrCreateCategoryForPath(organizationId, filePath, docsPath);

  // ---- Check if document already exists ----
  const existing = await getDocumentByFilePath(organizationId, filePath, projectId);

  if (existing) {
    // If the document was previously archived, unarchive it (re-added file)
    // If content hasn't changed, skip
    if (existing.contentHash === contentHash && !existing.archivedAt) {
      logger.debug(
        { ...logCtx, filePath, documentId: existing.id },
        "[docs-sync] Content unchanged, skipping"
      );
      return "skipped";
    }

    // Update document content + category
    await updateSyncedDocument(organizationId, existing.id, {
      title,
      content,
      contentHash,
      s3Key,
      filePath,
      ...(categoryId ? { categoryId } : {}),
    });

    // If it was archived, clear archivedAt (re-added)
    if (existing.archivedAt) {
      await unarchiveDocument(organizationId, existing.id);
    }

    // Create a new version record
    await createDocumentVersion({
      documentId: existing.id,
      contentHash,
      s3Key,
      commitSha: ref !== "HEAD" ? ref : undefined,
    });

    logger.info(
      { ...logCtx, filePath, documentId: existing.id, categoryId },
      "[docs-sync] Updated document"
    );
    return "updated";
  }

  // ---- Create new document ----
  const newDoc = await createSyncedDocument(organizationId, {
    title,
    content,
    projectId,
    filePath,
    contentHash,
    s3Key,
    ...(categoryId ? { categoryId } : {}),
  });

  // Create initial version
  await createDocumentVersion({
    documentId: newDoc.id,
    contentHash,
    s3Key,
    commitSha: ref !== "HEAD" ? ref : undefined,
  });

  logger.info(
    { ...logCtx, filePath, documentId: newDoc.id, categoryId },
    "[docs-sync] Created new document"
  );
  return "created";
};
