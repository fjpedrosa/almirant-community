import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  KanbanSquare,
  FileText,
  Sparkles,
  CheckSquare,
  Sprout,
  SquarePen,
  Search,
  MessageSquare,
  PanelLeftClose,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AlmirantLogo } from "@/components/icons/almirant-logo";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionSidebarGroup } from "./session-sidebar-group";
import { SessionSidebarItem } from "./session-sidebar-item";
import { TAB_ROUTES } from "@/app/(app-shell)/(dashboard)/components/hooks/use-navigation";
import type { UnifiedMobileDrawerProps } from "../../domain/types";

const navTabs = [
  { id: "todos", icon: CheckSquare },
  { id: "seeds", icon: Sprout },
  { id: "plan", icon: Sparkles },
  { id: "boards", icon: KanbanSquare },
  { id: "docs", icon: FileText },
] as const;

const isResumable = (status: string, createdAt: string): boolean => {
  if (status === "active") return false;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return new Date(createdAt) >= sevenDaysAgo;
};

export const UnifiedMobileDrawer: React.FC<UnifiedMobileDrawerProps> = ({
  isOpen,
  onOpenChange,
  activeTab,
  groups,
  activeSessionId,
  onSessionClick,
  onSessionDelete,
  onSessionResume,
  onNewSession,
  onSearchOpen,
  modelLabel,
}) => {
  const t = useTranslations("nav");
  const tPlan = useTranslations("aiPlanning");

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[85vw] max-w-sm p-0 gap-0 flex flex-col overflow-hidden"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>

        {/* === Logo header === */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <AlmirantLogo className="h-5 w-5" />
            <span className="font-semibold text-sm">Almirant</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => onOpenChange(false)}
            aria-label="Close menu"
          >
            <PanelLeftClose className="size-5" />
          </Button>
        </div>

        {/* === Navigation links === */}
        <nav className="flex flex-col gap-1 px-3 pt-4 pb-2 border-b border-border shrink-0">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const label = t(tab.id);
            const href = TAB_ROUTES[tab.id];

            return (
              <Link
                key={tab.id}
                href={href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* === Session history === */}
        <div className="flex flex-col gap-1.5 px-3 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start gap-2 h-11 text-sm"
              onClick={() => {
                onNewSession();
                onOpenChange(false);
              }}
            >
              <SquarePen className="size-4" />
              <span className="truncate">{tPlan("sidebar.newSession")}</span>
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-2 h-11 text-sm text-muted-foreground"
            onClick={() => {
              onSearchOpen();
              onOpenChange(false);
            }}
          >
            <Search className="size-4" />
            <span className="truncate">{tPlan("sidebar.search")}</span>
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0 [&>[data-radix-scroll-area-viewport]>div]:!block [&>[data-radix-scroll-area-viewport]>div]:!min-w-0">
          <div className="py-2">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-muted-foreground">
                <MessageSquare className="size-8 opacity-40" />
                <p className="text-xs">{tPlan("sidebar.empty")}</p>
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
                      onClick={() => {
                        onSessionClick(session.id);
                        onOpenChange(false);
                      }}
                      onDelete={() => onSessionDelete(session.id)}
                      onResume={() => {
                        onSessionResume(session.id);
                        onOpenChange(false);
                      }}
                    />
                  ))}
                </SessionSidebarGroup>
              ))
            )}
          </div>
        </ScrollArea>

        {/* === Model badge at bottom === */}
        {modelLabel && (
          <div className="border-t border-border px-3 py-2.5 shrink-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent backdrop-blur-sm border border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="truncate">{modelLabel}</span>
            </span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
