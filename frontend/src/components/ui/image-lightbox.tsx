"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
interface ImageLightboxProps {
  src: string;
  alt?: string;
  className?: string;
}

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  src,
  alt = "",
  className,
}) => {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className={className}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleOpen();
        }}
        role="button"
        tabIndex={0}
        style={{ cursor: "zoom-in" }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 overflow-auto">
          <DialogTitle className="sr-only">{alt || "Image preview"}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="w-full h-auto rounded-md"
          />
        </DialogContent>
      </Dialog>
    </>
  );
};
