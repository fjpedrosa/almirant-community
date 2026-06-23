import { describe, expect, it, mock } from "bun:test";
import {
  provisionUploadedFilesWorkspace,
  resolveUploadedFileTargetPath,
  type WorkspaceFileDownload,
} from "./uploaded-files-provisioner";
import type { ResolvedUploadedFilesWorkspace } from "./agent-workspace";

const workspace = (
  overrides: Partial<ResolvedUploadedFilesWorkspace> = {},
): ResolvedUploadedFilesWorkspace => ({
  kind: "uploaded_files",
  source: "explicit",
  fileIds: ["file-1"],
  unpackMode: "flat",
  ...overrides,
});

const downloadedFile = (
  overrides: Partial<WorkspaceFileDownload> = {},
): WorkspaceFileDownload => ({
  id: "file-1",
  fileName: "notes.txt",
  fileSize: 5,
  mimeType: "text/plain",
  contentBase64: Buffer.from("hello").toString("base64"),
  ...overrides,
});

describe("resolveUploadedFileTargetPath", () => {
  it("places flat uploads at workspace root with a sanitized basename", () => {
    const target = resolveUploadedFileTargetPath({
      workspaceRoot: "/workspace/repo",
      unpackMode: "flat",
      file: downloadedFile({
        fileName: "../../my report$.txt",
      }),
      usedRelativePaths: new Set(),
    });

    expect(target).toEqual({
      relativePath: "my_report_.txt",
      absolutePath: "/workspace/repo/my_report_.txt",
    });
  });

  it("preserves safe relative paths when requested", () => {
    const target = resolveUploadedFileTargetPath({
      workspaceRoot: "/workspace/repo",
      unpackMode: "preserve_paths",
      file: downloadedFile({
        fileName: "ignored.txt",
        workspacePath: "docs/specs/phase-2.txt",
      }),
      usedRelativePaths: new Set(),
    });

    expect(target).toEqual({
      relativePath: "docs/specs/phase-2.txt",
      absolutePath: "/workspace/repo/docs/specs/phase-2.txt",
    });
  });

  it("rejects path traversal when preserving paths", () => {
    expect(() =>
      resolveUploadedFileTargetPath({
        workspaceRoot: "/workspace/repo",
        unpackMode: "preserve_paths",
        file: downloadedFile({
          workspacePath: "../secrets.txt",
        }),
        usedRelativePaths: new Set(),
      }),
    ).toThrow("Unsafe uploaded file path");
  });

  it("deduplicates colliding target paths without overwriting files", () => {
    const usedRelativePaths = new Set<string>();

    const first = resolveUploadedFileTargetPath({
      workspaceRoot: "/workspace/repo",
      unpackMode: "flat",
      file: downloadedFile({ id: "file-1", fileName: "notes.txt" }),
      usedRelativePaths,
    });
    const second = resolveUploadedFileTargetPath({
      workspaceRoot: "/workspace/repo",
      unpackMode: "flat",
      file: downloadedFile({ id: "file-2", fileName: "notes.txt" }),
      usedRelativePaths,
    });

    expect(first.relativePath).toBe("notes.txt");
    expect(second.relativePath).toBe("notes-2.txt");
  });
});

describe("provisionUploadedFilesWorkspace", () => {
  it("downloads and writes each uploaded file into the container workspace", async () => {
    const writes: Array<{ path: string; content: string; mode: string }> = [];
    const downloadFile = mock(async (fileId: string) =>
      downloadedFile({
        id: fileId,
        fileName: `${fileId}.txt`,
        contentBase64: Buffer.from(`content:${fileId}`).toString("base64"),
      }),
    );

    await provisionUploadedFilesWorkspace({
      containerId: "container-1",
      workspacePath: "/workspace/repo",
      workspace: workspace({ fileIds: ["file-1", "file-2"] }),
      downloadFile,
      containerManager: {
        writeFileBufferViaExec: async (_containerId, filePath, content, mode) => {
          writes.push({
            path: filePath,
            content: content.toString("utf8"),
            mode: mode ?? "",
          });
        },
      },
    });

    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(writes).toEqual([
      { path: "/workspace/repo/file-1.txt", content: "content:file-1", mode: "0644" },
      { path: "/workspace/repo/file-2.txt", content: "content:file-2", mode: "0644" },
    ]);
  });

  it("enforces total uploaded workspace size limits", async () => {
    await expect(
      provisionUploadedFilesWorkspace({
        containerId: "container-1",
        workspacePath: "/workspace/repo",
        workspace: workspace({ fileIds: ["file-1", "file-2"] }),
        limits: {
          maxFiles: 5,
          maxFileBytes: 10,
          maxTotalBytes: 6,
        },
        downloadFile: async (fileId) =>
          downloadedFile({
            id: fileId,
            fileName: `${fileId}.txt`,
            contentBase64: Buffer.from("hello").toString("base64"),
          }),
        containerManager: {
          writeFileBufferViaExec: async () => {},
        },
      }),
    ).rejects.toThrow("Uploaded workspace files exceed total size limit");
  });
});
