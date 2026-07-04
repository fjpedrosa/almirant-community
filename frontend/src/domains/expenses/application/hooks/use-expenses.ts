"use client";

import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { expensesApi, expenseCategoriesApi, recurringExpensesApi } from "@/lib/api/client";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { expenseKeys, expenseMutationKeys } from "../../domain/query-keys";
import type {
  ExpenseWithRelations,
  PaginatedExpensesResponse,
  CreateExpenseRequest,
  UpdateExpenseRequest,
  ExpenseCategory,
  RecurringExpense,
  ExpenseAggregations,
} from "../../domain/types";

// Re-exported so existing imports (`from "./use-expenses"`) keep working.
export { expenseKeys, expenseMutationKeys };

export const useExpenses = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: [
      ...expenseKeys.list(`paginated:${params?.toString() ?? ""}`),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: async (): Promise<PaginatedExpensesResponse> => {
      const result = await expensesApi.listWithMeta(params);
      return { items: result.data as ExpenseWithRelations[], meta: result.meta };
    },
    placeholderData: keepPreviousData,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useExpense = (id: string | null) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: [...expenseKeys.detail(id ?? ""), `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: () => expensesApi.get(id!) as Promise<ExpenseWithRelations>,
    enabled: !!id && !!confirmedActiveTeamId,
  });
};

export const useExpenseAggregations = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: [
      ...expenseKeys.aggregations(params?.toString() ?? ""),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: () => expensesApi.getAggregations(params) as Promise<ExpenseAggregations>,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useExpenseCategories = () => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: [...expenseKeys.categories(), `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: () => expenseCategoriesApi.list() as Promise<ExpenseCategory[]>,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useRecurringExpenses = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: [...expenseKeys.recurring(), params?.toString() ?? "", `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: () => recurringExpensesApi.list(params) as Promise<RecurringExpense[]>,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useCreateExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExpenseRequest) => expensesApi.create(data),
    onSuccess: () => {
      for (const queryKey of expenseMutationKeys()) {
        queryClient.invalidateQueries({ queryKey });
      }
      showToast.success("Expense created");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to create expense");
    },
  });
};

export const useUpdateExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateExpenseRequest }) =>
      expensesApi.update(id, data),
    onSuccess: (_result, variables) => {
      for (const queryKey of expenseMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
      showToast.success("Expense updated");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to update expense");
    },
  });
};

export const useDeleteExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expensesApi.delete(id),
    onSuccess: (_result, id) => {
      for (const queryKey of expenseMutationKeys(id)) {
        queryClient.invalidateQueries({ queryKey });
      }
      showToast.success("Expense deleted");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to delete expense");
    },
  });
};

export const useUploadInvoice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      expensesApi.uploadInvoice(id, file),
    onSuccess: (_result, variables) => {
      for (const queryKey of expenseMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
      showToast.success("Invoice uploaded");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to upload invoice");
    },
  });
};

export const useCreateExpenseWithInvoice = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => expensesApi.createWithInvoice(file),
    onSuccess: () => {
      for (const queryKey of expenseMutationKeys()) {
        queryClient.invalidateQueries({ queryKey });
      }
      showToast.success("Expense created from invoice");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to create expense from invoice");
    },
  });
};

export const useCreateExpenseCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => expenseCategoriesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.categories() });
      showToast.success("Category created");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to create category");
    },
  });
};

export const useUpdateExpenseCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      expenseCategoriesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.categories() });
      showToast.success("Category updated");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to update category");
    },
  });
};

export const useDeleteExpenseCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expenseCategoriesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.categories() });
      showToast.success("Category deleted");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to delete category");
    },
  });
};

export const useCreateRecurringExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => recurringExpensesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.recurring() });
      showToast.success("Recurring expense created");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to create recurring expense");
    },
  });
};

export const useUpdateRecurringExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      recurringExpensesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.recurring() });
      showToast.success("Recurring expense updated");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to update recurring expense");
    },
  });
};

export const useDeleteRecurringExpense = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recurringExpensesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.recurring() });
      showToast.success("Recurring expense deleted");
    },
    onError: (error: Error) => {
      showToast.error(error.message || "Failed to delete recurring expense");
    },
  });
};
