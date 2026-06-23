"use client";

import { useState, useRef, useCallback } from "react";

import type { ConfirmDialogOptions } from "@/domains/shared/domain/types";

export const useConfirmDialog = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (opts: ConfirmDialogOptions): Promise<boolean> => {
      setOptions(opts);
      setIsOpen(true);
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setIsOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setIsOpen(false);
  }, []);

  return { isOpen, options, confirm, handleConfirm, handleCancel };
};
