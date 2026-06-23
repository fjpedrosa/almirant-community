"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FileText, File, Image as ImageIcon, Film, FileArchive } from "lucide-react";

interface CommentContentProps {
  html: string;
  className?: string;
}

/**
 * Determines the appropriate icon for a file based on its extension or URL.
 */
const getFileIconFromUrl = (url: string): typeof FileText => {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i.test(lower)) return ImageIcon;
  if (/\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(lower)) return Film;
  if (/\.(pdf|doc|docx|txt|rtf|odt)(\?|$)/i.test(lower)) return FileText;
  if (/\.(zip|rar|7z|tar|gz)(\?|$)/i.test(lower)) return FileArchive;
  return File;
};

/**
 * Extracts filename from a URL for display.
 */
const getFileNameFromUrl = (url: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").pop() || "File";
    return decodeURIComponent(filename);
  } catch {
    return "File";
  }
};

/**
 * Renders sanitized HTML comment content with thumbnail images that open
 * in a full-screen lightbox on click. Uses a ref + useEffect to attach
 * click handlers to <img> elements rendered via dangerouslySetInnerHTML.
 * 
 * Also handles:
 * - Image fallback when URL fails to load
 * - Enhanced styling for file attachment links
 */
export const CommentContent: React.FC<CommentContentProps> = ({
  html,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxAlt, setLightboxAlt] = useState<string>("");
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Event delegation: handle clicks on <img> elements inside the container
  const handleContainerClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      if (failedImages.has(img.src)) return;
      event.preventDefault();
      event.stopPropagation();
      setLightboxSrc(img.src);
      setLightboxAlt(img.alt || "Image preview");
    }
  }, [failedImages]);

  // Event delegation: handle keyboard events on <img> elements inside the container
  const handleContainerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as HTMLElement;
    if (target.tagName === "IMG") {
      const img = target as HTMLImageElement;
      if (failedImages.has(img.src)) return;
      event.preventDefault();
      setLightboxSrc(img.src);
      setLightboxAlt(img.alt || "Image preview");
    }
  }, [failedImages]);

  const handleImageError = useCallback((event: Event) => {
    const img = event.currentTarget as HTMLImageElement;
    setFailedImages((prev) => new Set(prev).add(img.src));
  }, []);

  // Effect to style images and file links
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const images = container.querySelectorAll("img");
    const links = container.querySelectorAll("a[href]");

    // Style images for lightbox interaction and attach error handlers
    for (const img of images) {
      // Skip already failed images
      if (failedImages.has(img.src)) {
        img.style.display = "none";
        continue;
      }

      img.style.cursor = "zoom-in";
      img.setAttribute("role", "button");
      img.setAttribute("tabindex", "0");
      img.addEventListener("error", handleImageError);
    }

    // Style file attachment links
    for (const link of links) {
      const href = link.getAttribute("href");
      if (!href) continue;

      // Check if this is a file attachment link (has file-like URL or file-link class)
      const isFileLink = link.classList.contains("file-link") || 
        href.startsWith("/api/") ||
        (href.startsWith("http") && !href.includes("mention"));

      if (isFileLink) {
        // Add file-card styling
        link.classList.add(
          "flex",
          "items-center",
          "flex-wrap",
          "gap-2",
          "w-full",
          "min-w-0",
          "px-3",
          "py-1.5",
          "my-1",
          "rounded-md",
          "border",
          "border-border",
          "bg-muted/30",
          "text-sm",
          "text-foreground",
          "no-underline",
          "hover:bg-muted/50",
          "transition-colors",
          "max-w-full",
          "break-all",
          "whitespace-normal"
        );
        
        // Remove default underline styling
        link.classList.remove("underline", "text-primary");
      }
    }

    return () => {
      for (const img of images) {
        img.removeEventListener("error", handleImageError);
      }
    };
  }, [html, failedImages, handleImageError]);

  // Render failed image placeholders
  const renderFailedImagePlaceholders = useCallback(() => {
    if (failedImages.size === 0) return null;
    
    return Array.from(failedImages).map((src) => {
      const filename = getFileNameFromUrl(src);
      const IconComponent = getFileIconFromUrl(src);
      
      return (
        <div
          key={`failed-${src}`}
          className="inline-flex items-center gap-2 px-3 py-2 my-2 rounded-md border border-destructive/30 bg-destructive/10 text-sm max-w-full"
        >
          <IconComponent className="h-4 w-4 shrink-0 text-destructive" />
          <span className="truncate text-destructive/80">{filename}</span>
          <span className="text-xs text-muted-foreground shrink-0">(imagen no disponible)</span>
        </div>
      );
    });
  }, [failedImages]);

  return (
    <>
      {renderFailedImagePlaceholders()}
      
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onKeyDown={handleContainerKeyDown}
        className={cn(
          "prose dark:prose-invert prose-sm max-w-none min-w-0 break-words",
          "prose-p:my-0 prose-p:text-foreground",
          "[&_.mention]:bg-primary/15 [&_.mention]:text-primary [&_.mention]:rounded [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:font-medium",
          "[&_span[data-type='mention']]:bg-primary/15 [&_span[data-type='mention']]:text-primary [&_span[data-type='mention']]:rounded [&_span[data-type='mention']]:px-1 [&_span[data-type='mention']]:py-0.5 [&_span[data-type='mention']]:font-medium",
          "[&_img]:max-h-[120px] [&_img]:w-auto [&_img]:rounded-md [&_img]:my-2 [&_img]:object-cover [&_img]:hover:opacity-90 [&_img]:transition-opacity",
          "[&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_a]:break-all [&_a]:whitespace-normal",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <Dialog
        open={lightboxSrc !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLightboxSrc(null);
            setLightboxAlt("");
          }
        }}
      >
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 overflow-auto">
          <DialogTitle className="sr-only">{lightboxAlt}</DialogTitle>
          {lightboxSrc && !failedImages.has(lightboxSrc) && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={lightboxSrc}
              alt={lightboxAlt}
              className="w-full h-auto rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
