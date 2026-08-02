"use client";

import {
  useDeleteUserStorageFile,
  useDownloadUserStorageFile,
  useUploadUserStorageFile,
  useUserStorageFiles,
  useUserStorageUsage,
} from "../../application/hooks/use-user-storage";
import { saveDownloadedFile } from "../../application/save-downloaded-file";
import type {
  UploadUserStorageFileInput,
  UserStorageFile,
} from "../../domain/types";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { UserStoragePanel } from "../components/user-storage-panel";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Storage request failed";

export const UserStorageContainer = () => {
  const usageQuery = useUserStorageUsage();
  const filesQuery = useUserStorageFiles();
  const uploadMutation = useUploadUserStorageFile();
  const deleteMutation = useDeleteUserStorageFile();
  const downloadMutation = useDownloadUserStorageFile();

  const upload = async (input: UploadUserStorageFileInput) => {
    try {
      await uploadMutation.mutateAsync(input);
      showToast.success("File uploaded");
      return true;
    } catch (error) {
      showToast.error("Upload failed", { description: errorMessage(error) });
      return false;
    }
  };

  const download = async (file: UserStorageFile) => {
    try {
      const blob = await downloadMutation.mutateAsync(file.id);
      saveDownloadedFile(blob, file.fileName);
    } catch (error) {
      showToast.error("Download failed", { description: errorMessage(error) });
    }
  };

  const remove = async (file: UserStorageFile) => {
    try {
      await deleteMutation.mutateAsync(file.id);
      showToast.success("File deleted");
    } catch (error) {
      showToast.error("Delete failed", { description: errorMessage(error) });
    }
  };

  const queryError = usageQuery.error ?? filesQuery.error;

  return (
    <UserStoragePanel
      usage={usageQuery.data}
      files={filesQuery.data ?? []}
      isLoading={usageQuery.isLoading || filesQuery.isLoading}
      isUploading={uploadMutation.isPending}
      deletingFileId={
        deleteMutation.isPending ? (deleteMutation.variables ?? null) : null
      }
      downloadingFileId={
        downloadMutation.isPending ? (downloadMutation.variables ?? null) : null
      }
      errorMessage={queryError ? errorMessage(queryError) : null}
      onUpload={upload}
      onDownload={download}
      onDelete={remove}
    />
  );
};
