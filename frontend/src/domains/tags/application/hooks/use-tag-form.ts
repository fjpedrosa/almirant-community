"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateTag, useDeleteTag } from "@/domains/tags/application/hooks/use-tags";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import type { TagFormData } from "@/domains/tags/domain/types";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Color hexadecimal inválido"),
});

const colorOptions = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6366f1", "#14b8a6",
];

export const useTagForm = () => {
  const createTag = useCreateTag();
  const deleteTag = useDeleteTag();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const form = useForm<TagFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      color: "#6366f1",
    },
  });

  const onSubmit = useCallback(async (data: TagFormData) => {
    try {
      await createTag.mutateAsync(data);
      showToast.success("Tag creado correctamente");
      form.reset();
      setDialogOpen(false);
    } catch {
      showToast.error("Error al crear el tag");
    }
  }, [createTag, form]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    const confirmed = await confirm({
      title: "Eliminar tag",
      description: `¿Estás seguro de eliminar el tag "${name}"? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      cancelLabel: "Cancelar",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      await deleteTag.mutateAsync(id);
      showToast.success("Tag eliminado");
    } catch {
      showToast.error("Error al eliminar el tag");
    }
  }, [confirm, deleteTag]);

  return {
    form,
    dialogOpen,
    setDialogOpen,
    onSubmit,
    handleDelete,
    isCreating: createTag.isPending,
    colorOptions,
    confirmDialogProps,
  };
};
