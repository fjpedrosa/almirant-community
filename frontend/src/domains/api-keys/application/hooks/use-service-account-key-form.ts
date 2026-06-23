"use client";

import { useState, useCallback } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  useServiceAccounts,
  useRotateServiceAccountKey,
} from "./use-service-accounts";

export const useServiceAccountKeyForm = () => {
  const { data: serviceAccounts, isLoading } = useServiceAccounts();
  const rotateKeyMutation = useRotateServiceAccountKey();

  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRotateKey = useCallback(
    async (id: string, name: string) => {
      setRotatingId(id);
      try {
        const result = await rotateKeyMutation.mutateAsync(id);
        setNewKey(result.key);
        setRotateDialogOpen(true);
        setCopied(false);
        showToast.success(`Key rotated for ${name}`);
      } catch {
        showToast.error("Failed to rotate key");
      } finally {
        setRotatingId(null);
      }
    },
    [rotateKeyMutation]
  );

  const handleCopyKey = useCallback(async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      showToast.success("Key copied to clipboard");
    } catch {
      showToast.error("Failed to copy key");
    }
  }, [newKey]);

  const handleDialogClose = useCallback((open: boolean) => {
    if (!open) {
      setNewKey(null);
      setCopied(false);
    }
    setRotateDialogOpen(open);
  }, []);

  return {
    serviceAccounts: serviceAccounts ?? [],
    isLoading,
    rotatingId,
    rotateDialogOpen,
    newKey,
    copied,
    handleRotateKey,
    handleCopyKey,
    handleDialogClose,
  };
};
