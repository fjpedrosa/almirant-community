"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateBoard, useUpdateBoard, useCreateBoardFromTemplate } from "./use-boards";
import type { BoardWithStats, CreateBoardRequest, UpdateBoardRequest } from "../../domain/types";

const boardFormSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string().optional(),
  area: z.enum(["desarrollo", "ventas", "prospeccion", "marketing", "general"]).optional(),
  isDefault: z.boolean().optional(),
});

export type BoardFormData = z.infer<typeof boardFormSchema>;

export const useBoardForm = (onSuccess?: () => void) => {
  const createBoard = useCreateBoard();
  const updateBoard = useUpdateBoard();
  const createFromTemplate = useCreateBoardFromTemplate();

  const form = useForm<BoardFormData>({
    resolver: zodResolver(boardFormSchema),
    defaultValues: {
      name: "",
      description: "",
      area: "general",
      isDefault: false,
    },
  });

  const resetForm = () => {
    form.reset({
      name: "",
      description: "",
      area: "general",
      isDefault: false,
    });
  };

  const onCreateSubmit = async (data: CreateBoardRequest) => {
    try {
      await createBoard.mutateAsync({
        name: data.name,
        description: data.description,
        area: data.area || "general",
        isDefault: data.isDefault || false,
      });
      showToast.success("Board creado correctamente");
      resetForm();
      onSuccess?.();
    } catch {
      showToast.error("Error al crear el board");
    }
  };

  const onUpdateSubmit = async (id: string, data: UpdateBoardRequest) => {
    try {
      await updateBoard.mutateAsync({
        id,
        data: {
          name: data.name,
          description: data.description,
          area: data.area,
          isDefault: data.isDefault,
          allowedTypes: data.allowedTypes,
        },
      });
      showToast.success("Board actualizado correctamente");
      onSuccess?.();
    } catch {
      showToast.error("Error al actualizar el board");
    }
  };

  const onCreateFromTemplate = async (templateId: string, name?: string) => {
    try {
      await createFromTemplate.mutateAsync({ templateId, name });
      showToast.success("Board creado desde plantilla");
      onSuccess?.();
    } catch {
      showToast.error("Error al crear el board desde plantilla");
    }
  };

  const setFormFromBoard = (board: BoardWithStats) => {
    form.reset({
      name: board.name,
      description: board.description || "",
      area: board.area,
      isDefault: board.isDefault,
    });
  };

  return {
    form,
    resetForm,
    onCreateSubmit,
    onUpdateSubmit,
    onCreateFromTemplate,
    setFormFromBoard,
    isCreating: createBoard.isPending,
    isUpdating: updateBoard.isPending,
    isCreatingFromTemplate: createFromTemplate.isPending,
    isLoading: createBoard.isPending || updateBoard.isPending || createFromTemplate.isPending,
  };
};
