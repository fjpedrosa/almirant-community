import { useTranslations } from "next-intl";
import { PanelLeftClose, PanelLeftOpen, SquarePen, Search, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SessionSidebarGroup } from "./session-sidebar-group";
import { SessionSidebarItem } from "./session-sidebar-item";
import type { SessionSidebarProps } from "../../domain/types";

const isResumable = (status: string, createdAt: string): boolean => {
  if (status === "active") return false;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return new Date(createdAt) >= sevenDaysAgo;
};

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  isOpen,
  groups,
  activeSessionId,
  onToggle,
  onSessionClick,
  onSessionDelete,
  onSessionResume,
  onNewSession,
  onSearchOpen,
  fullWidth,
}) => {
  const t = useTranslations("aiPlanning");

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden">
      {/* Sidebar panel */}
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden bg-muted/30 transition-all duration-300 ease-in-out",
          fullWidth
            ? "w-full opacity-100"
            : cn("border-r border-border", isOpen ? "w-64 opacity-100" : "w-0 opacity-0 border-r-0"),
        )}
      >
        <div
          className={cn(
            "flex h-full min-h-0 flex-col overflow-hidden",
            fullWidth ? "min-w-0" : "min-w-64",
          )}
        >
          {/* Header */}
          <div className="flex flex-col gap-1.5 px-3 pt-4 pb-3">
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-start gap-2 h-9 text-sm"
                onClick={onNewSession}
              >
                <SquarePen className="size-4" />
                <span className="truncate">{t("sidebar.newSession")}</span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={t("sidebar.toggle")}>
                    <PanelLeftClose className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("sidebar.collapse")}</TooltipContent>
              </Tooltip>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-2 h-9 text-sm text-muted-foreground"
              onClick={onSearchOpen}
            >
              <Search className="size-4" />
              <span className="truncate">{t("sidebar.search")}</span>
            </Button>
          </div>

          {/* Session list */}
          <ScrollArea className="min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0">
            <div className="py-2">
              {groups.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
                  <MessageSquare className="size-8 opacity-40" />
                  <p className="text-xs">{t("sidebar.empty")}</p>
                </div>
              ) : (
                groups.map((group) => (
                  <SessionSidebarGroup key={group.label} label={group.label}>
                    {group.sessions.map((session) => (
                      <SessionSidebarItem
                        key={session.id}
                        id={session.id}
                        title={session.title}
                        relativeDate={session.relativeDate}
                        creatorName={session.creatorName}
                        creatorImage={session.creatorImage}
                        isActive={activeSessionId === session.id}
                        canResume={isResumable(session.status, session.createdAt)}
                        status={session.status}
                        onClick={() => onSessionClick(session.id)}
                        onDelete={() => onSessionDelete(session.id)}
                        onResume={() => onSessionResume(session.id)}
                      />
                    ))}
                  </SessionSidebarGroup>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Collapsed toggle button — fades in after sidebar collapse animation */}
      {!isOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute left-2 top-3 z-10 animate-in fade-in duration-200"
              style={{ animationDelay: "300ms", animationFillMode: "backwards" }}
              onClick={onToggle}
              aria-label={t("sidebar.toggle")}
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("sidebar.expand")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
