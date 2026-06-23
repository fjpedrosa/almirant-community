"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Webhook, Plus } from "lucide-react";
import { WebhookCard } from "./webhook-card";
import type { WebhooksListProps } from "../../domain/types";

export const WebhooksList: React.FC<WebhooksListProps> = ({
  webhooks,
  isLoading,
  testingId,
  onToggle,
  onTest,
  onDelete,
  onCreateClick,
  triggerLabels,
}) => {
  const t = useTranslations("webhooks");
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (webhooks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Webhook className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">
            {t("empty")}
          </p>
          <Button onClick={onCreateClick}>
            <Plus className="h-4 w-4 mr-2" />
            {t("createFirst")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {webhooks.map((webhook) => (
        <WebhookCard
          key={webhook.id}
          webhook={webhook}
          testingId={testingId}
          onToggle={onToggle}
          onTest={onTest}
          onDelete={onDelete}
          triggerLabels={triggerLabels}
        />
      ))}
    </div>
  );
};
