"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { ImportProgressStepProps } from "../../domain/types";

export const ImportProgressStep: React.FC<ImportProgressStepProps> = () => {
  const t = useTranslations("imports.progress");
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg font-medium">{t("importing")}</p>
        <p className="text-sm text-muted-foreground">
          {t("wait")}
        </p>
      </CardContent>
    </Card>
  );
};
