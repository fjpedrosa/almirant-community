"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import type { ImportCompletedStepProps } from "../../domain/types";

export const ImportCompletedStep: React.FC<ImportCompletedStepProps> = ({
  result,
  onReset,
}) => {
  const t = useTranslations("imports.completed");
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
        <p className="text-2xl font-bold mb-2">{t("title")}</p>
        <div className="flex gap-4 mb-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-500">
              {result.success}
            </p>
            <p className="text-sm text-muted-foreground">{t("success")}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-red-500">
              {result.errors}
            </p>
            <p className="text-sm text-muted-foreground">{t("errors")}</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold">{result.total}</p>
            <p className="text-sm text-muted-foreground">{t("total")}</p>
          </div>
        </div>
        <div className="flex gap-4">
          <Button variant="outline" onClick={onReset}>
            {t("importMore")}
          </Button>
          <Button asChild>
            <a href="/leads">{t("viewLeads")}</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
