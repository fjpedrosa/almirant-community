import { useTranslations } from "next-intl";
import { Bot } from "lucide-react";
import type { ActiveModelBadgeProps } from "../../domain/types";

// Usage:
// <ActiveModelBadge providerLabel="Anthropic" model="claude-opus-4-6" visible={true} />

export const ActiveModelBadge: React.FC<ActiveModelBadgeProps> = ({
  providerLabel,
  model,
  visible,
}) => {
  const t = useTranslations("aiPlanning.modelSelector");

  if (!visible) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 bg-muted/40 border-b border-border text-xs text-muted-foreground shrink-0">
      <Bot className="size-3.5 shrink-0" />
      <span className="truncate">
        {t("usingModel", { provider: providerLabel, model })}
      </span>
    </div>
  );
};
