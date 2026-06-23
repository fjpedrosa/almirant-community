"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUpdateExpense } from "./use-expenses";
import type { Expense } from "../../domain/types";

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  amount: z.string().min(1, "Amount is required"),
  currency: z.enum(["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "MXN", "BRL", "CLP", "COP", "ARS"]),
  expenseDate: z.string().min(1, "Date is required"),
  description: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  paidByUserId: z.string().nullable().optional(),
  status: z.enum(["draft", "pending_approval", "approved", "rejected", "paid", "void"]).optional(),
  projectId: z.string().nullable().optional(),
});

export type EditExpenseFormValues = z.infer<typeof schema>;

export const useEditExpenseForm = (expense: Expense | null, onSuccess?: () => void) => {
  const { mutate: updateExpense, isPending } = useUpdateExpense();

  const form = useForm<EditExpenseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      amount: "",
      currency: "EUR",
      expenseDate: new Date().toISOString().split("T")[0],
      description: null,
      vendor: null,
      categoryId: null,
      paidByUserId: null,
      status: "draft",
      projectId: null,
    },
  });

  useEffect(() => {
    if (expense) {
      form.reset({
        title: expense.title,
        amount: expense.amount,
        currency: expense.currency,
        expenseDate: expense.expenseDate,
        description: expense.description ?? null,
        vendor: expense.vendor ?? null,
        categoryId: expense.categoryId ?? null,
        paidByUserId: expense.paidByUserId ?? null,
        status: expense.status,
        projectId: expense.projectId ?? null,
      });
    }
  }, [expense, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!expense) return;
    updateExpense(
      { id: expense.id, data: { ...values } },
      {
        onSuccess: () => {
          onSuccess?.();
        },
      }
    );
  });

  return { form, onSubmit, isPending };
};
