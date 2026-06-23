import path from "node:path";
import type { ContainerManager } from "./container-manager";
import type { ResolvedUploadedFilesWorkspace } from "./agent-workspace";

export type WorkspaceFileDownload = {
  id: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  contentBase64: string;
  workspacePath?: string | null;
};

export type UploadedFilesProvisionerLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export type UploadedFilesProvisionerInput = {
  containerId: string;
  workspacePath: string;
  workspace: ResolvedUploadedFilesWorkspace;
  downloadFile: (fileId: string) => Promise<WorkspaceFileDownload>;
  containerManager: Pick<ContainerManager, "writeFileBufferViaExec">;
  limits?: Partial<UploadedFilesProvisionerLimits>;
};

const DEFAULT_LIMITS: UploadedFilesProvisionerLimits = {
  maxFiles: 50,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
};

const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._ -]+$/;

const sanitizeFlatBasename = (fileName: string): string => {
  const normalized = fileName.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized).trim();
  const fallback = basename.length > 0 && basename !== "." && basename !== ".."
    ? basename
    : "uploaded-file";

  const sanitized = fallback
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.{1,2}$/, "uploaded-file");

  return sanitized.length > 0 ? sanitized : "uploaded-file";
};

const assertSafeRelativePath = (rawPath: string): string => {
  if (rawPath.includes("\0")) {
    throw new Error("Unsafe uploaded file path: NUL bytes are not allowed");
  }
  if (rawPath.includes("\\") || rawPath.includes("\"") || rawPath.includes("$") || rawPath.includes("`")) {
    throw new Error("Unsafe uploaded file path: shell-sensitive characters are not allowed");
  }
  if (path.posix.isAbsolute(rawPath)) {
    throw new Error("Unsafe uploaded file path: absolute paths are not allowed");
  }

  const normalized = path.posix.normalize(rawPath.trim());
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error("Unsafe uploaded file path: traversal is not allowed");
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || !SAFE_SEGMENT_PATTERN.test(segment))) {
    throw new Error("Unsafe uploaded file path: only safe relative path segments are allowed");
  }

  return normalized;
};

const dedupeRelativePath = (
  relativePath: string,
  usedRelativePaths: Set<string>,
): string => {
  if (!usedRelativePaths.has(relativePath)) {
    usedRelativePaths.add(relativePath);
    return relativePath;
  }

  const dir = path.posix.dirname(relativePath);
  const ext = path.posix.extname(relativePath);
  const stem = path.posix.basename(relativePath, ext);
  let counter = 2;

  while (true) {
    const candidateName = `${stem}-${counter}${ext}`;
    const candidate = dir === "." ? candidateName : `${dir}/${candidateName}`;
    if (!usedRelativePaths.has(candidate)) {
      usedRelativePaths.add(candidate);
      return candidate;
    }
    counter += 1;
  }
};

export const resolveUploadedFileTargetPath = ({
  workspaceRoot,
  unpackMode,
  file,
  usedRelativePaths,
}: {
  workspaceRoot: string;
  unpackMode: "flat" | "preserve_paths";
  file: WorkspaceFileDownload;
  usedRelativePaths: Set<string>;
}): { relativePath: string; absolutePath: string } => {
  const candidatePath =
    unpackMode === "preserve_paths"
      ? file.workspacePath ?? file.fileName
      : sanitizeFlatBasename(file.fileName);

  const safeRelativePath =
    unpackMode === "preserve_paths"
      ? assertSafeRelativePath(candidatePath)
      : assertSafeRelativePath(sanitizeFlatBasename(candidatePath));

  const relativePath = dedupeRelativePath(safeRelativePath, usedRelativePaths);

  return {
    relativePath,
    absolutePath: path.posix.join(workspaceRoot, relativePath),
  };
};

const decodeBase64 = (contentBase64: string): Buffer => {
  try {
    return Buffer.from(contentBase64, "base64");
  } catch (error) {
    throw new Error(
      `Invalid uploaded workspace file content: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const provisionUploadedFilesWorkspace = async ({
  containerId,
  workspacePath,
  workspace,
  downloadFile,
  containerManager,
  limits: limitOverrides,
}: UploadedFilesProvisionerInput): Promise<{ filesWritten: number; totalBytes: number }> => {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };

  if (workspace.fileIds.length === 0) {
    throw new Error("uploaded_files workspace requires at least one fileId");
  }

  if (workspace.fileIds.length > limits.maxFiles) {
    throw new Error(`uploaded_files workspace exceeds max file count (${limits.maxFiles})`);
  }

  const usedRelativePaths = new Set<string>();
  let totalBytes = 0;
  let filesWritten = 0;

  for (const fileId of workspace.fileIds) {
    const file = await downloadFile(fileId);
    const content = decodeBase64(file.contentBase64);

    if (content.length > limits.maxFileBytes) {
      throw new Error(`Uploaded workspace file ${file.id} exceeds per-file size limit`);
    }

    totalBytes += content.length;
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error("Uploaded workspace files exceed total size limit");
    }

    const target = resolveUploadedFileTargetPath({
      workspaceRoot: workspacePath,
      unpackMode: workspace.unpackMode ?? "flat",
      file,
      usedRelativePaths,
    });

    await containerManager.writeFileBufferViaExec(
      containerId,
      target.absolutePath,
      content,
      "0644",
    );
    filesWritten += 1;
  }

  return { filesWritten, totalBytes };
};
