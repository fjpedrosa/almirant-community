"use client";

import { User } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AgentAnswerMessageProps } from "../../domain/types";

const formatTimestamp = (date: string): string => {
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const AgentAnswerMessage: React.FC<AgentAnswerMessageProps> = ({
  interaction,
}) => {
  const t = useTranslations("agents.thread");

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3",
        "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30"
      )}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
        <User className="h-4 w-4 text-green-700 dark:text-green-400" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium text-green-900 dark:text-green-100">
          {interaction.answerText}
        </p>

        <div className="flex items-center gap-2">
          {interaction.answeredBy && (
            <span className="text-xs text-green-700 dark:text-green-400">
              {interaction.answeredBy}
            </span>
          )}
          {interaction.answeredAt && (
            <span className="text-xs text-green-600 dark:text-green-500">
              {formatTimestamp(interaction.answeredAt)}
            </span>
          )}
          {!interaction.answeredBy && !interaction.answeredAt && (
            <span className="text-xs text-green-600 dark:text-green-500">
              {t("answered")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
