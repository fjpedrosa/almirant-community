"use client";

import { Button } from "@/components/ui/button";
import { Paperclip, X, File, Image, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (type: string) => {
  if (type.startsWith("image/")) return Image;
  if (type.includes("pdf") || type.includes("document") || type.includes("text"))
    return FileText;
  return File;
};

interface PendingFilesSectionProps {
  files: File[];
  onRemove: (index: number) => void;
}

export const PendingFilesSection: React.FC<PendingFilesSectionProps> = ({
  files,
  onRemove,
}) => {
  const t = useTranslations("workItems.detail");
  if (files.length === 0) return null;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-1.5">
        <Paperclip className="h-4 w-4" />
        {t("pendingFiles")}
        <span className="text-muted-foreground">({files.length})</span>
      </label>
      <p className="text-xs text-muted-foreground">
        {t("pendingFilesHint")}
      </p>
      <div className="space-y-1.5">
        {files.map((file, index) => {
          const IconComponent = getFileIcon(file.type);
          return (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 p-2 rounded-md border border-dashed bg-muted/30 text-sm"
            >
              <IconComponent className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="text-muted-foreground text-xs shrink-0">
                {formatFileSize(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => onRemove(index)}
                aria-label="Remove file"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
