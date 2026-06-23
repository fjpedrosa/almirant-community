import { useTranslations } from "next-intl";
import { Sparkles, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModelSelector } from "./model-selector";
import type { PlanChatHeaderProps } from "../../domain/types";

// Usage:
// <PlanChatHeader
//   modelSelectorProps={modelProps}
//   isSessionActive={false}
//   onNewSession={handleNewSession}
// />
//
// When session is active, project and model become read-only badges:
// <PlanChatHeader
//   ...
//   isSessionActive={true}
//   activeProjectName="My Project"
//   activeModelLabel="Anthropic / claude-sonnet-4-20250514"
//   ...
// />

export const PlanChatHeader: React.FC<PlanChatHeaderProps> = ({
  modelSelectorProps,
  isSessionActive,
  activeProjectName,
  activeModelLabel,
  onNewSession,
}) => {
  const t = useTranslations("aiPlanning");

  return (
    <header className="flex items-center gap-2 sm:gap-3 border-b border-border px-3 sm:px-4 py-2.5 shrink-0">
      {/* Title */}
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="size-4 text-primary shrink-0" />
        <h1 className="text-sm font-semibold truncate hidden sm:block">
          {t("title")}
        </h1>
      </div>

      {/* Project badge: only shown when session is active */}
      {isSessionActive && activeProjectName && (
        <Badge variant="secondary" className="text-xs truncate max-w-[200px]">
          {activeProjectName}
        </Badge>
      )}

      {/* Model: compact selector when inactive, badge when active */}
      {isSessionActive ? (
        <Badge variant="outline" className="text-xs truncate max-w-[120px] sm:max-w-[220px]">
          {activeModelLabel}
        </Badge>
      ) : (
        <ModelSelector {...modelSelectorProps} compact />
      )}

      <div className="flex-1" />

      {/* New session button */}
      <Button
        variant="outline"
        size="sm"
        onClick={onNewSession}
        className="shrink-0 h-8"
        aria-label={t("header.newSession")}
      >
        <MessageSquarePlus className="size-4" />
        <span className="hidden sm:inline ml-1.5">
          {t("header.newSession")}
        </span>
      </Button>
    </header>
  );
};
