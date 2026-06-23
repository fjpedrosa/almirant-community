"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Trash2,
  FileText,
  Image,
  Film,
  FileArchive,
  File,
  Play,
  Monitor,
  Smartphone,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { AttachmentSectionProps } from "../../domain/types";

const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (mimeType: string | null) => {
  if (!mimeType) return File;
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.startsWith("video/")) return Film;
  if (
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("text")
  )
    return FileText;
  if (
    mimeType.includes("zip") ||
    mimeType.includes("archive") ||
    mimeType.includes("compressed")
  )
    return FileArchive;
  return File;
};

export const AttachmentSection: React.FC<AttachmentSectionProps> = ({
  attachments,
  isLoading,
  onUpload,
  onDelete,
  isUploading,
}) => {
  const t = useTranslations("workItems.detail");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="whitespace-nowrap shrink-0"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          {isUploading ? t("uploading") : t("uploadFile")}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground py-2">
          {t("loadingAttachments")}
        </div>
      )}

      {!isLoading && attachments.length === 0 && (
        <div className="text-sm text-muted-foreground py-2 text-center border border-dashed rounded-md p-4">
          {t("noAttachments")}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map((attachment) => {
            const IconComponent = getFileIcon(attachment.mimeType);
            const isWalkthroughVideo =
              attachment.mimeType?.startsWith("video/") &&
              attachment.metadata?.kind === "walkthrough";
            const viewport = attachment.metadata?.viewport as
              | "desktop"
              | "mobile"
              | undefined;

            if (isWalkthroughVideo) {
              return (
                <div
                  key={attachment.id}
                  className="rounded-md border bg-muted/30 text-sm overflow-hidden"
                >
                  {/* Inline video preview with play overlay */}
                  <a
                    href={attachment.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block bg-black/80 group"
                  >
                    <div
                      className={`flex items-center justify-center ${
                        viewport === "mobile"
                          ? "aspect-[9/16] max-h-48 mx-auto"
                          : "aspect-video max-h-48"
                      }`}
                    >
                      <video
                        src={attachment.fileUrl}
                        preload="metadata"
                        muted
                        className="w-full h-full object-contain pointer-events-none"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/20 transition-colors">
                        <div className="rounded-full bg-white/90 p-2">
                          <Play className="h-5 w-5 text-black fill-black" />
                        </div>
                      </div>
                    </div>
                  </a>
                  {/* Info row */}
                  <div className="flex items-center gap-2 p-2">
                    <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate" title={attachment.fileName}>
                      {attachment.fileName}
                    </span>
                    {viewport && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 capitalize">
                        {viewport === "desktop" ? (
                          <Monitor className="h-3 w-3" />
                        ) : (
                          <Smartphone className="h-3 w-3" />
                        )}
                        {viewport}
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-xs shrink-0">
                      {formatFileSize(attachment.fileSize)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 max-md:h-9 max-md:w-9 shrink-0"
                      onClick={() => onDelete(attachment.id)}
                      aria-label="Delete attachment"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={attachment.id}
                className="flex items-center gap-2 p-2 rounded-md border bg-muted/30 text-sm"
              >
                <IconComponent className="h-4 w-4 shrink-0 text-muted-foreground" />
                <a
                  href={attachment.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 truncate hover:underline"
                  title={attachment.fileName}
                >
                  {attachment.fileName}
                </a>
                <span className="text-muted-foreground text-xs shrink-0">
                  {formatFileSize(attachment.fileSize)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 max-md:h-9 max-md:w-9 shrink-0"
                  onClick={() => onDelete(attachment.id)}
                  aria-label="Delete attachment"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
