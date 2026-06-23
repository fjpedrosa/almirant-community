"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateRecurringExpense } from "./use-expenses";

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  vendor: z.string().nullable().optional(),
  amount: z.string().min(1, "Amount is required"),
  currency: z.enum(["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "MXN", "BRL", "CLP", "COP", "ARS"]),
  recurrence: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  anchorDate: z.string().min(1, "Start date is required"),
  alertDaysBefore: z.number().min(0).optional(),
  categoryId: z.string().nullable().optional(),
});

export type CreateRecurringExpenseFormValues = z.infer<typeof schema>;

export const useCreateRecurringExpenseForm = (onSuccess?: () => void) => {
  const { mutate: createRecurring, isPending } = useCreateRecurringExpense();

  const form = useForm<CreateRecurringExpenseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      vendor: null,
      amount: "",
      currency: "EUR",
      recurrence: "monthly",
      anchorDate: new Date().toISOString().split("T")[0],
      alertDaysBefore: 7,
      categoryId: null,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    createRecurring(values, {
      onSuccess: () => {
        form.reset();
        onSuccess?.();
      },
    });
  });

  return { form, onSubmit, isPending };
};
