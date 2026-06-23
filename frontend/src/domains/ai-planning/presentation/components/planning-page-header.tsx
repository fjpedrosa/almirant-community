/** @deprecated Use plan-chat-header.tsx instead */
import { useTranslations } from "next-intl";
import { MessageSquare, MessageSquarePlus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelector } from "./model-selector";
import type { PlanningPageHeaderProps } from "../../domain/types";

export const PlanningPageHeader: React.FC<PlanningPageHeaderProps> = ({
  projects,
  boards,
  selectedProjectId,
  selectedBoardId,
  isLoadingProjects,
  isLoadingBoards,
  onProjectChange,
  onBoardChange,
  modelSelectorProps,
  isChatOpen,
  onToggleChat,
  onNewConversation,
}) => {
  const t = useTranslations("aiPlanning");

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="size-5 text-primary shrink-0" />
        <h1 className="text-lg font-semibold truncate hidden sm:block">
          {t("title")}
        </h1>
      </div>

      {/* Project selector */}
      <Select
        value={selectedProjectId}
        onValueChange={onProjectChange}
        disabled={isLoadingProjects}
      >
        <SelectTrigger className="w-[160px] h-8 text-xs">
          <SelectValue placeholder={t("selector.selectProject")} />
        </SelectTrigger>
        <SelectContent>
          {projects.length === 0 ? (
            <div className="py-2 px-2 text-xs text-muted-foreground text-center">
              {t("selector.noProjects")}
            </div>
          ) : (
            projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      {/* Board selector */}
      <Select
        value={selectedBoardId}
        onValueChange={onBoardChange}
        disabled={isLoadingBoards || !selectedProjectId}
      >
        <SelectTrigger className="w-[160px] h-8 text-xs">
          <SelectValue placeholder={t("selector.selectBoard")} />
        </SelectTrigger>
        <SelectContent>
          {boards.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1" />

      {/* Model selector: compact chip on mobile, full on sm+ */}
      <div className="flex sm:hidden shrink-0">
        <ModelSelector {...modelSelectorProps} compact />
      </div>
      <div className="hidden sm:flex shrink-0">
        <ModelSelector {...modelSelectorProps} />
      </div>

      {/* Toggle chat */}
      <Button
        variant={isChatOpen ? "default" : "outline"}
        size="icon"
        onClick={onToggleChat}
        className={cn("size-8 shrink-0")}
        aria-label={t("toggleChat")}
      >
        <MessageSquare className="size-4" />
      </Button>

      {/* New conversation */}
      <Button
        variant="outline"
        size="sm"
        onClick={onNewConversation}
        className="shrink-0"
      >
        <MessageSquarePlus className="size-4" />
        <span className="hidden sm:inline ml-1.5">
          {t("newConversation")}
        </span>
      </Button>
    </header>
  );
};
