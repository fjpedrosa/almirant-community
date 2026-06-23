"use client";

import { useState, useCallback, useRef } from "react";

interface UseFileDropZoneOptions {
  onFilesDropped: (files: File[]) => void;
  disabled?: boolean;
}

export const useFileDropZone = ({ onFilesDropped, disabled = false }: UseFileDropZoneOptions) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounterRef.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    []
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragOver(false);
      }
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const alreadyHandled = e.isDefaultPrevented();
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;
      if (disabled || alreadyHandled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFilesDropped(files);
      }
    },
    [disabled, onFilesDropped]
  );

  return {
    isDragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
};
