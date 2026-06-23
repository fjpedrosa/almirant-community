"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Webhook, Play, Trash2 } from "lucide-react";
import type { WebhookCardProps } from "../../domain/types";

export const WebhookCard: React.FC<WebhookCardProps> = ({
  webhook,
  testingId,
  onToggle,
  onTest,
  onDelete,
  triggerLabels,
}) => {
  const t = useTranslations("webhooks");
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={`shrink-0 p-2 rounded-full ${
              webhook.isActive ? "bg-green-100 dark:bg-green-900/30" : "bg-muted"
            }`}
          >
            <Webhook
              className={`h-5 w-5 ${
                webhook.isActive ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
              }`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium">{webhook.name}</p>
              <Badge variant="outline">
                {triggerLabels[webhook.trigger]}
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {webhook.url}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Switch
            checked={webhook.isActive ?? false}
            onCheckedChange={(checked) => onToggle(webhook.id, checked)}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => onTest(webhook.id)}
            disabled={testingId === webhook.id}
            aria-label={t("actions.testAriaLabel")}
          >
            <Play
              className={`h-4 w-4 ${
                testingId === webhook.id ? "animate-pulse" : ""
              }`}
            />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("delete.confirm")}>
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete.title", { name: webhook.name })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("delete.description")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => onDelete(webhook.id, webhook.name)}
                >
                  {t("delete.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
};
