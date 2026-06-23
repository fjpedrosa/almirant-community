"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileUp } from "lucide-react";
import type { ImportMappingStepProps } from "../../domain/types";

export const ImportMappingStep: React.FC<ImportMappingStepProps> = ({
  preview,
  mapping,
  onMappingChange,
  onImport,
  onCancel,
  leadFieldOptions,
}) => {
  const t = useTranslations("imports.mapping");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{t("title")}</span>
            <Badge variant="secondary">{preview.totalRows} {t("rows")}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Column Mapping */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("csvColumn")}</TableHead>
                <TableHead>{t("crmField")}</TableHead>
                <TableHead>{t("sample")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.headers.map((header) => (
                <TableRow key={header}>
                  <TableCell className="font-medium">{header}</TableCell>
                  <TableCell>
                    <Select
                      value={mapping[header] || "skip"}
                      onValueChange={(value) =>
                        onMappingChange(header, value as never)
                      }
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {leadFieldOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                    {preview.sampleRows[0]?.[header] || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle>{t("preview")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.headers.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.sampleRows.map((row, i) => (
                  <TableRow key={i}>
                    {preview.headers.map((header) => (
                      <TableCell key={header} className="truncate max-w-[150px]">
                        {row[header] || "-"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onCancel}>
          {tCommon("cancel")}
        </Button>
        <Button onClick={onImport}>
          <FileUp className="h-4 w-4 mr-2" />
          {t("importButton", { count: preview.totalRows })}
        </Button>
      </div>
    </div>
  );
};
