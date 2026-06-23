"use client";

import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFileDropZone } from "../../application/hooks/use-file-drop-zone";

interface FileDropZoneProps {
  onFilesDropped: (files: File[]) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({
  onFilesDropped,
  children,
  disabled = false,
}) => {
  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } =
    useFileDropZone({ onFilesDropped, disabled });

  const t = useTranslations("workItems.detail");

  return (
    <div
      className="relative w-full min-w-0"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg border-2 border-dashed border-primary animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">{t("dropFilesHere")}</p>
          </div>
        </div>
      )}
    </div>
  );
};
