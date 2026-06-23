"use client";

import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SeedQuickAddProps } from "../../domain/types";

export const SeedQuickAdd: React.FC<SeedQuickAddProps> = ({
  onSubmit,
  isSubmitting,
}) => {
  const t = useTranslations("planning.quickAdd");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const title = (formData.get("title") as string).trim();
        if (!title) return;
        const description =
          (formData.get("description") as string | null)?.trim() || undefined;
        onSubmit({ title, description });
        e.currentTarget.reset();
      }}
    >
      <Input
        name="title"
        placeholder={t("placeholder")}
        required
        minLength={2}
        maxLength={200}
        disabled={isSubmitting}
        className="h-8 flex-1 text-sm"
        aria-label={t("titleAriaLabel")}
      />
      <Input
        name="description"
        placeholder={t("descriptionPlaceholder")}
        disabled={isSubmitting}
        className="hidden h-8 flex-1 text-sm sm:block"
        aria-label={t("descriptionAriaLabel")}
      />
      <Button
        type="submit"
        size="sm"
        disabled={isSubmitting}
        className="h-8 shrink-0"
      >
        {isSubmitting ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="mr-1.5 h-3.5 w-3.5" />
        )}
        {t("create")}
      </Button>
    </form>
  );
};
