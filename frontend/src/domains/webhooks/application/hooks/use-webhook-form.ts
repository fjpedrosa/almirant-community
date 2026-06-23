"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useToggleWebhook,
  useTestWebhook,
} from "./use-webhooks";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  url: z.string().url("URL inv\u00e1lida"),
  trigger: z.enum([
    "work_item_created",
    "work_item_updated",
    "work_item_moved",
    "work_item_deleted",
    "comment_added",
    "attachment_added",
    "sprint_closed",
    "milestone_completed",
  ]),
});

export type WebhookFormData = z.infer<typeof formSchema>;

export const triggerLabels: Record<string, string> = {
  work_item_created: "Work item creado",
  work_item_updated: "Work item actualizado",
  work_item_moved: "Work item movido",
  work_item_deleted: "Work item eliminado",
  comment_added: "Comentario a\u00f1adido",
  attachment_added: "Adjunto a\u00f1adido",
  sprint_closed: "Sprint cerrado",
  milestone_completed: "Milestone completado",
};

export const useWebhookForm = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const createMutation = useCreateWebhook();
  const deleteMutation = useDeleteWebhook();
  const toggleMutation = useToggleWebhook();
  const testMutation = useTestWebhook();

  const form = useForm<WebhookFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      url: "",
      trigger: "work_item_created",
    },
  });

  const onSubmit = useCallback(
    (data: WebhookFormData) => {
      createMutation.mutate(data, {
        onSuccess: () => {
          showToast.success("Webhook creado correctamente");
          form.reset();
          setDialogOpen(false);
        },
        onError: () => {
          showToast.error("Error al crear el webhook");
        },
      });
    },
    [createMutation, form]
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      const confirmed = await confirm({
        title: "Eliminar webhook",
        description: `¿Estás seguro de eliminar el webhook "${name}"? Esta acción no se puede deshacer.`,
        confirmLabel: "Eliminar",
        cancelLabel: "Cancelar",
        variant: "destructive",
      });
      if (!confirmed) return;

      deleteMutation.mutate(id, {
        onSuccess: () => {
          showToast.success("Webhook eliminado");
        },
        onError: () => {
          showToast.error("Error al eliminar el webhook");
        },
      });
    },
    [confirm, deleteMutation]
  );

  const handleToggle = useCallback(
    (id: string, isActive: boolean) => {
      toggleMutation.mutate({ id, isActive });
    },
    [toggleMutation]
  );

  const handleTest = useCallback(
    async (id: string) => {
      setTestingId(id);
      try {
        const result = await testMutation.mutateAsync(id);
        if (result.success) {
          showToast.success("Webhook enviado correctamente");
        } else {
          showToast.error(`Error: ${result.error}`);
        }
      } catch {
        showToast.error("Error al probar el webhook");
      } finally {
        setTestingId(null);
      }
    },
    [testMutation]
  );

  return {
    form,
    dialogOpen,
    setDialogOpen,
    onSubmit,
    handleDelete,
    handleToggle,
    handleTest,
    testingId,
    isCreating: createMutation.isPending,
    triggerLabels,
    confirmDialogProps,
  };
};
