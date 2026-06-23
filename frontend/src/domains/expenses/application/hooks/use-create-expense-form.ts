"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useCreateExpense } from "./use-expenses";

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

export type CreateExpenseFormValues = z.infer<typeof schema>;

export const useCreateExpenseForm = (onSuccess?: () => void) => {
  const { mutate: createExpense, isPending } = useCreateExpense();

  const form = useForm<CreateExpenseFormValues>({
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

  const onSubmit = form.handleSubmit((values) => {
    createExpense(
      { ...values, amount: values.amount },
      {
        onSuccess: () => {
          form.reset();
          onSuccess?.();
        },
        onError: () => {
          showToast.error("Error al crear el gasto");
        },
      }
    );
  });

  return { form, onSubmit, isPending };
};
