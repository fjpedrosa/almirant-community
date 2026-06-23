"use client";

import { Clock, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { AgentStatusMessageProps } from "../../domain/types";

const formatTimestamp = (date: string): string => {
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const AgentStatusMessage: React.FC<AgentStatusMessageProps> = ({
  interaction,
}) => {
  const t = useTranslations("agents.thread");

  const isExpired = interaction.status === "expired";
  const Icon = isExpired ? Clock : XCircle;
  const statusLabel = isExpired ? t("expired") : t("cancelled");

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        "border-muted bg-muted/30"
      )}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {interaction.questionText}
        </p>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {statusLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(interaction.createdAt)}
          </span>
          {interaction.expiresAt && isExpired && (
            <span className="text-xs text-muted-foreground">
              {t("expiredAt", {
                time: formatTimestamp(interaction.expiresAt),
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
