import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { adminFeedbackApi } from "@/lib/api/client";
import { feedbackKeys } from "./use-feedback-traceability";
import type {
  PromoteFeedbackRequest,
  PromoteFeedbackResponse,
  FeedbackItem,
  WorkItemType,
  Priority,
} from "../../domain/types";

const promoteFeedbackSchema = z.object({
  workItemType: z.enum(["task", "story", "feature", "epic"]),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  notes: z.string().optional(),
});

type PromoteFeedbackFormValues = z.infer<typeof promoteFeedbackSchema>;

export const usePromoteFeedback = (
  feedbackItem: FeedbackItem | null,
  options: {
    boardId: string;
    boardColumnId: string;
    promotedBy?: string;
    onSuccess?: (response: PromoteFeedbackResponse) => void;
  }
) => {
  const queryClient = useQueryClient();

  const form = useForm<PromoteFeedbackFormValues>({
    resolver: zodResolver(promoteFeedbackSchema),
    mode: "onChange",
    defaultValues: {
      workItemType: feedbackItem?.aiSuggestedType ?? "task",
      title: feedbackItem?.aiSuggestedTitle ?? feedbackItem?.title ?? "",
      description: feedbackItem?.aiSuggestedSummary ?? feedbackItem?.content ?? "",
      priority: "medium",
      notes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: PromoteFeedbackFormValues) => {
      if (!feedbackItem) throw new Error("No feedback item selected");

      const payload: PromoteFeedbackRequest = {
        workItemType: values.workItemType as WorkItemType,
        title: values.title,
        description: values.description,
        priority: values.priority as Priority | undefined,
        boardId: options.boardId,
        boardColumnId: options.boardColumnId,
        notes: values.notes,
        promotedBy: options.promotedBy,
      };

      return adminFeedbackApi.promoteFeedbackItem(feedbackItem.id, payload) as Promise<PromoteFeedbackResponse>;
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      options.onSuccess?.(response);
    },
  });

  const handleSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  const resetForm = (item: FeedbackItem | null) => {
    form.reset({
      workItemType: item?.aiSuggestedType ?? "task",
      title: item?.aiSuggestedTitle ?? item?.title ?? "",
      description: item?.aiSuggestedSummary ?? item?.content ?? "",
      priority: "medium",
      notes: "",
    });
  };

  return {
    form,
    handleSubmit,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    resetForm,
    isFormValid: form.formState.isValid,
  };
};
