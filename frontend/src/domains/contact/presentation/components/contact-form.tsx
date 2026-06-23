"use client";

import type { UseFormReturn } from "react-hook-form";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContactFormData } from "../../application/hooks/use-contact-form";

const REASON_OPTIONS = [
  "general",
  "support",
  "partnership",
  "feedback",
  "other",
] as const;

interface ContactFormProps {
  form: UseFormReturn<ContactFormData>;
  isSubmitting: boolean;
  isSuccess: boolean;
  error: string | null;
  onSubmit: ReturnType<UseFormReturn<ContactFormData>["handleSubmit"]>;
}

export const ContactForm = ({
  form,
  isSubmitting,
  isSuccess,
  error,
  onSubmit,
}: ContactFormProps) => {
  const t = useTranslations("landing.contact");

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-primary/5 p-8 text-center">
        <CheckCircle2 className="size-10 text-green-500" />
        <h3 className="text-xl font-semibold">{t("form.success.title")}</h3>
        <p className="text-muted-foreground">
          {t("form.success.description")}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="contact-email">{t("form.email.label")}</Label>
        <Input
          id="contact-email"
          type="email"
          autoComplete="email"
          placeholder={t("form.email.placeholder")}
          disabled={isSubmitting}
          {...form.register("email")}
        />
        {form.formState.errors.email?.message ? (
          <p className="text-sm text-red-500">
            {t(`validation.${form.formState.errors.email.message}`)}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-reason">{t("form.reason.label")}</Label>
        <Select
          value={form.watch("reason") ?? ""}
          onValueChange={(value) =>
            form.setValue("reason", value as ContactFormData["reason"], {
              shouldValidate: true,
            })
          }
          disabled={isSubmitting}
        >
          <SelectTrigger id="contact-reason">
            <SelectValue placeholder={t("form.reason.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {REASON_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`form.reason.options.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.formState.errors.reason?.message ? (
          <p className="text-sm text-red-500">
            {t(`validation.${form.formState.errors.reason.message}`)}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-message">{t("form.message.label")}</Label>
        <Textarea
          id="contact-message"
          placeholder={t("form.message.placeholder")}
          rows={5}
          disabled={isSubmitting}
          {...form.register("message")}
        />
        {form.formState.errors.message?.message ? (
          <p className="text-sm text-red-500">
            {t(`validation.${form.formState.errors.message.message}`)}
          </p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : null}
        {isSubmitting ? t("form.submitting") : t("form.submit")}
      </Button>
    </form>
  );
};
