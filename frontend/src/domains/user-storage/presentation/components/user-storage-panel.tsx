"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  Download,
  FileText,
  HardDrive,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type {
  UploadUserStorageFileInput,
  UserStorageFile,
  UserStorageUsage,
} from "../../domain/types";
import { MAX_USER_STORAGE_PATH_LENGTH } from "../../domain/types";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export const formatStorageBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;
  const rounded = value >= 10 || Number.isInteger(value)
    ? Math.round(value)
    : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
};

const quotaPercentage = (usage?: UserStorageUsage): number => {
  if (!usage || usage.quotaBytes === 0) return 0;
  return Math.min(
    100,
    ((usage.usedBytes + usage.reservedBytes) / usage.quotaBytes) * 100,
  );
};

const formattedDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export interface UserStoragePanelProps {
  usage?: UserStorageUsage;
  files: UserStorageFile[];
  isLoading: boolean;
  isUploading: boolean;
  deletingFileId: string | null;
  downloadingFileId: string | null;
  errorMessage: string | null;
  onUpload: (
    input: UploadUserStorageFileInput,
  ) => Promise<boolean | void> | boolean | void;
  onDownload: (file: UserStorageFile) => Promise<void> | void;
  onDelete: (file: UserStorageFile) => Promise<void> | void;
}

export const UserStoragePanel = ({
  usage,
  files,
  isLoading,
  isUploading,
  deletingFileId,
  downloadingFileId,
  errorMessage,
  onUpload,
  onDownload,
  onDelete,
}: UserStoragePanelProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [virtualPath, setVirtualPath] = useState("");

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile || isUploading) return;

    const uploaded = await onUpload({
      file: selectedFile,
      ...(virtualPath.trim() ? { path: virtualPath.trim() } : {}),
    });
    if (uploaded === false) return;
    setSelectedFile(null);
    setVirtualPath("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <HardDrive className="size-6 text-primary" aria-hidden="true" />
          Storage
        </h1>
        <p className="text-muted-foreground">
          Private files shared by all of your agents, independent of workspace.
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {errorMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Storage usage</CardTitle>
            <CardDescription>
              Your personal quota is shared across every agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && !usage ? (
              <p className="text-sm text-muted-foreground">Loading storage...</p>
            ) : usage ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">
                    {formatStorageBytes(usage.usedBytes)} used of{" "}
                    {formatStorageBytes(usage.quotaBytes)}
                  </p>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {Math.round(quotaPercentage(usage))}%
                  </span>
                </div>
                <Progress
                  value={quotaPercentage(usage)}
                  aria-label="Storage quota used"
                />
                {usage.reservedBytes > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatStorageBytes(usage.reservedBytes)} temporarily reserved
                    for uploads.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {usage.usedObjects.toLocaleString()} of{" "}
                  {usage.quotaObjects.toLocaleString()} files used
                  {usage.reservedObjects > 0
                    ? ` (${usage.reservedObjects.toLocaleString()} uploading)`
                    : ""}
                  .
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Usage information is unavailable.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload a file</CardTitle>
            <CardDescription>
              Set a virtual path so agents can find it predictably.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submitUpload}>
              <div className="space-y-2">
                <Label htmlFor="user-storage-file">File</Label>
                <Input
                  ref={fileInputRef}
                  id="user-storage-file"
                  type="file"
                  onChange={(event) =>
                    setSelectedFile(event.target.files?.item(0) ?? null)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-storage-path">
                  Virtual path (optional)
                </Label>
                <Input
                  id="user-storage-path"
                  value={virtualPath}
                  onChange={(event) => setVirtualPath(event.target.value)}
                  placeholder={selectedFile?.name ?? "research/notes.txt"}
                  maxLength={MAX_USER_STORAGE_PATH_LENGTH}
                />
              </div>
              <Button
                type="submit"
                disabled={!selectedFile || isUploading}
                className="w-full"
              >
                <UploadCloud className="mr-2 size-4" aria-hidden="true" />
                {isUploading ? "Uploading..." : "Upload file"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Files</CardTitle>
          <CardDescription>
            Files uploaded here are available to your agents through Almirant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && files.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading storage...</p>
          ) : files.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FileText className="size-5" aria-hidden="true" />
              </div>
              <h2 className="font-medium">No files yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a file to make it available to all of your agents.
              </p>
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <FileText className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium">
                        {file.virtualPath}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatStorageBytes(file.sizeBytes)}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>{formattedDate(file.updatedAt)}</span>
                        {file.kind === "plugin_bundle" && (
                          <Badge variant="secondary">Plugin bundle</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Download ${file.virtualPath}`}
                      disabled={downloadingFileId === file.id}
                      onClick={() => void onDownload(file)}
                    >
                      <Download className="mr-2 size-4" aria-hidden="true" />
                      {downloadingFileId === file.id ? "Downloading..." : "Download"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${file.virtualPath}`}
                          disabled={deletingFileId === file.id}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete {file.virtualPath}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes the file from your storage and
                            from every agent that uses it.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void onDelete(file)}
                          >
                            Delete file
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
