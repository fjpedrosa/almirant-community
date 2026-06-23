"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  useCreateApiKey,
  useRevokeApiKey,
} from "@/domains/api-keys/application/hooks/use-api-keys";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import type { ApiKeyFormData, ApiKeyCreated } from "@/domains/api-keys/domain/types";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const useApiKeyForm = () => {
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [createdDialogOpen, setCreatedDialogOpen] = useState(false);
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const form = useForm<ApiKeyFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
    },
  });

  const onSubmit = useCallback(
    async (data: ApiKeyFormData) => {
      try {
        const result = await createApiKey.mutateAsync(data.name);
        setCreatedKey(result);
        form.reset();
        setDialogOpen(false);
        setCreatedDialogOpen(true);
        showToast.success("API key created");
      } catch {
        showToast.error("Failed to create API key");
      }
    },
    [createApiKey, form]
  );

  const handleRevoke = useCallback(
    async (id: string, name: string) => {
      const confirmed = await confirm({
        title: "Revoke API Key",
        description: `Are you sure you want to revoke "${name}"? This cannot be undone.`,
        confirmLabel: "Revoke",
        cancelLabel: "Cancel",
        variant: "destructive",
      });
      if (!confirmed) return;

      try {
        await revokeApiKey.mutateAsync(id);
        showToast.success("API key revoked");
      } catch {
        showToast.error("Failed to revoke API key");
      }
    },
    [confirm, revokeApiKey]
  );

  const handleCreatedDialogClose = useCallback(
    (open: boolean) => {
      setCreatedDialogOpen(open);
      if (!open) {
        setCreatedKey(null);
      }
    },
    []
  );

  return {
    form,
    dialogOpen,
    setDialogOpen,
    createdKey,
    createdDialogOpen,
    handleCreatedDialogClose,
    onSubmit,
    handleRevoke,
    isCreating: createApiKey.isPending,
    confirmDialogProps,
  };
};
