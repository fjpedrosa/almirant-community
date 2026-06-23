"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload } from "lucide-react";
import type { ImportUploadStepProps } from "../../domain/types";

export const ImportUploadStep: React.FC<ImportUploadStepProps> = ({
  getRootProps,
  getInputProps,
  isDragActive,
}) => {
  const t = useTranslations("imports.upload");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50"
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-lg font-medium mb-2">
            {isDragActive
              ? t("dragActive")
              : t("dragInactive")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("headerRequired")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
