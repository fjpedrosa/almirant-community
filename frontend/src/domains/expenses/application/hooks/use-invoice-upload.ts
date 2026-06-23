"use client";

import { useUploadInvoice, useCreateExpenseWithInvoice } from "./use-expenses";

export const useInvoiceUpload = () => {
  const { mutate: uploadInvoice, isPending: isUploading } = useUploadInvoice();
  const { mutate: createWithInvoice, isPending: isCreating } = useCreateExpenseWithInvoice();

  const uploadForExpense = (expenseId: string, file: File, onSuccess?: () => void) => {
    uploadInvoice({ id: expenseId, file }, { onSuccess });
  };

  const createFromInvoice = (file: File, onSuccess?: () => void) => {
    createWithInvoice(file, { onSuccess });
  };

  return { uploadForExpense, createFromInvoice, isUploading, isCreating };
};
