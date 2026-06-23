"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WebhookInfoCardProps } from "../../domain/types";

const examplePayload = {
  event: "work_item_moved",
  timestamp: "2026-01-21T10:30:00Z",
  data: {
    workItem: {
      id: "uuid",
      title: "Implementar login con OAuth",
      type: "task",
      priority: "high",
      previousColumn: "In Progress",
      currentColumn: "Review",
    },
  },
};

export const WebhookInfoCard: React.FC<WebhookInfoCardProps> = () => {
  const t = useTranslations("webhooks.info");
  return (
    <Card className="bg-muted/50">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        <p>
          {t("description")}
        </p>
        <p>
          <strong>{t("examplePayload")}</strong>
        </p>
        <pre className="bg-background p-3 rounded-lg text-xs overflow-x-auto">
          {JSON.stringify(examplePayload, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
};
