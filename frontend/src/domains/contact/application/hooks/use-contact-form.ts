"use client";

import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { contactApi } from "../api/contact-api";

const CONTACT_REASONS = [
  "general",
  "support",
  "partnership",
  "feedback",
  "other",
] as const;

export const contactFormSchema = z.object({
  email: z
    .string()
    .min(1, "emailRequired")
    .email("emailInvalid"),
  reason: z.enum(CONTACT_REASONS, {
    error: "reasonRequired",
  }),
  message: z
    .string()
    .min(1, "messageRequired")
    .min(10, "messageMin"),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

export const useContactForm = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      email: "",
      reason: undefined,
      message: "",
    },
    mode: "onTouched",
  });

  const onSubmit = useCallback(
    async (values: ContactFormData) => {
      setIsSubmitting(true);
      setError(null);

      try {
        await contactApi.submit(values);
        setIsSuccess(true);
        form.reset();
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : "An unexpected error occurred. Please try again.";
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [form]
  );

  return {
    form,
    isSubmitting,
    isSuccess,
    error,
    onSubmit: form.handleSubmit(onSubmit),
  };
};
