import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import {
  KanbanSquare,
  FileText,
  Sparkles,
  Sprout,
  Menu,
  MessageSquareHeart,
  MessageCircleQuestion,
  Bot,
  Inbox,
  Brain,
  LibraryBig,
  NotebookTabs,
} from "lucide-react";
import { AlmirantLogo } from "@/components/icons/almirant-logo";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TopNavUserAvatar } from "./top-nav-user-avatar";
import { FeedbackWidgetContainer } from "@/domains/feedback/presentation/containers/feedback-widget-container";
import { DashboardNavExtraActions } from "@/cloud/dashboard-nav-extra-actions";
import { PendingQuestionsContainer } from "@/domains/agents/presentation/containers/pending-questions-container";
import { NotificationBellContainer } from "@/domains/notifications/presentation/containers/notification-bell-container";
import { UsageNavButtonContainer } from "./usage-nav-button-container";
import { TAB_ROUTES } from "./hooks/use-navigation";
import {
  NavDropdownMenu,
  FeatureFlagBadge,
  type NavDropdownMenuItem,
} from "./nav-dropdown-menu";
import { WorkspaceBreadcrumbContainer } from "./workspace-breadcrumb-container";
import { MobileWorkspaceName } from "./mobile-workspace-name";

interface TopNavigationBarProps {
  activeTab: string;
  hideOnMobile?: boolean;
  /** Set of route IDs hidden because their PostHog feature flag is off. */
  hiddenRouteIds?: Set<string>;
  /** Set of route IDs that are feature-flagged (shown with a badge to users who have access). */
  featureFlaggedRouteIds?: Set<string>;
  /** Whether the Brain dropdown trigger should be highlighted (user is on /docs or /ask). */
  isBrainActive?: boolean;
}

const EMPTY_SET = new Set<string>();

/**
 * Pipe separator component for visual grouping in navigation.
 * Hidden from assistive technology.
 */
const PipeSeparator: React.FC = () => (
  <span aria-hidden="true" className="text-muted-foreground/30 select-none">
    |
  </span>
);

export const TopNavigationBar: React.FC<TopNavigationBarProps> = ({
  activeTab,
  hideOnMobile = false,
  hiddenRouteIds = EMPTY_SET,
  featureFlaggedRouteIds = EMPTY_SET,
  isBrainActive = false,
}) => {
  const t = useTranslations("nav");

  // Build Brain dropdown items
  const brainItems: NavDropdownMenuItem[] = [
    { id: "handbook", icon: LibraryBig, label: t("handbook"), href: TAB_ROUTES.handbook },
    { id: "docs", icon: FileText, label: t("docs"), href: TAB_ROUTES.docs },
    { id: "ask", icon: MessageCircleQuestion, label: t("ask"), href: TAB_ROUTES.ask },
  ].map((item) => ({
    ...item,
    hidden: hiddenRouteIds.has(item.id),
    isBeta: featureFlaggedRouteIds.has(item.id),
  }));

  const brainHidden = hiddenRouteIds.has("brain");
  const agentsHidden = hiddenRouteIds.has("agents");

  // Check if Brain dropdown has any visible items
  const hasBrainItems = brainItems.some((item) => !item.hidden);
  const showBrainBetaBadge = brainItems.some((item) => !item.hidden && item.isBeta);

  // Nav link styling helper
  const navLinkClassName = (isActive: boolean) =>
    cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
      isActive
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    );

  // Mobile link styling helper
  const mobileLinkClassName = (isActive: boolean) =>
    cn(
      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
      isActive
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    );

  return (
    <div className={cn("w-full bg-card border-b", hideOnMobile && "hidden md:block")}>
      <div className="flex items-center justify-between px-4 h-14 overflow-hidden">
        {/* Left: App icon + name + mobile hamburger */}
        <div className="flex items-center gap-2">
          {/* Mobile hamburger menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0 flex flex-col">
              <SheetTitle className="sr-only">{t("appName")}</SheetTitle>
              <div className="flex items-center gap-2 px-4 h-14 border-b">
                <AlmirantLogo className="h-5 w-5" />
                <span className="font-semibold text-sm">{t("appName")}</span>
              </div>
              {/* Mobile workspace name display */}
              <MobileWorkspaceName />
              <nav className="flex flex-col gap-1 p-2 overflow-y-auto">
                {/* Triage Section: Inbox */}
                <div className="mt-3 first:mt-0">
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <Inbox className="h-3.5 w-3.5" />
                    {t("inbox")}
                  </div>
                  <Link
                    href={TAB_ROUTES.todos}
                    prefetch
                    className={mobileLinkClassName(activeTab === "todos")}
                  >
                    <Inbox className="h-4 w-4" />
                    {t("inbox")}
                  </Link>
                </div>

                {/* Workflow Section: Ideate, Think, Run */}
                <div className="mt-3">
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <Sparkles className="h-3.5 w-3.5" />
                    Workflow
                  </div>
                  <Link
                    href={TAB_ROUTES.seeds}
                    prefetch
                    className={mobileLinkClassName(activeTab === "seeds")}
                  >
                    <Sprout className="h-4 w-4" />
                    {t("seeds")}
                  </Link>
                  <Link
                    href={TAB_ROUTES.plan}
                    prefetch
                    className={mobileLinkClassName(activeTab === "plan")}
                  >
                    <Sparkles className="h-4 w-4" />
                    {t("plan")}
                  </Link>
                  <Link
                    href={TAB_ROUTES.boards}
                    prefetch
                    className={mobileLinkClassName(activeTab === "boards")}
                  >
                    <KanbanSquare className="h-4 w-4" />
                    {t("boards")}
                  </Link>
                </div>

                {/* Resources Section: Brain items + Agents */}
                <div className="mt-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <Brain className="h-3.5 w-3.5" />
                      Resources
                    </div>
                    {!brainHidden &&
                      brainItems
                        .filter((item) => !item.hidden)
                        .map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <Link
                              key={item.id}
                              href={item.href}
                              prefetch
                              className={mobileLinkClassName(activeTab === item.id)}
                            >
                              <ItemIcon className="h-4 w-4" />
                              {item.label}
                              {item.isBeta && <FeatureFlagBadge />}
                            </Link>
                          );
                        })}
                    <Link
                      href={TAB_ROUTES.notes}
                      prefetch
                      className={mobileLinkClassName(activeTab === "notes")}
                    >
                      <NotebookTabs className="h-4 w-4" />
                      {t("notes")}
                    </Link>
                    {!agentsHidden && (
                      <Link
                        href={TAB_ROUTES.agents}
                        prefetch
                        className={mobileLinkClassName(activeTab === "agents")}
                      >
                        <Bot className="h-4 w-4" />
                        {t("agents")}
                      </Link>
                    )}
                </div>
              </nav>
              {/* Feedback badge — pinned to bottom. Wrapped in SheetClose so
                  this menu is dismissed as the feedback sheet opens: two
                  stacked Radix overlays fight over the scroll lock, and the
                  screenshot the widget captures on open would otherwise show
                  the navigation menu instead of the page being reported. */}
              <div className="mt-auto p-3 border-t border-border">
                <SheetClose asChild>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent("open-feedback"));
                    }}
                    className="relative flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                  >
                    <span className="relative">
                      <MessageSquareHeart className="h-4 w-4" />
                      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary animate-ping" />
                      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
                    </span>
                    Feedback
                  </button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>

          <AlmirantLogo className="h-5 w-5" />
          <span className="font-semibold text-sm">{t("appName")}</span>

          {/* Desktop workspace breadcrumb */}
          <div className="hidden md:flex items-center">
            <WorkspaceBreadcrumbContainer />
          </div>

        </div>

        {/* Center: 3 groups with pipe separators (hidden on mobile) */}
        {/* Layout: Inbox | Ideate Think Run | Brain Agents */}
        <nav className="hidden md:flex items-center gap-6">
          {/* Group 1: Triage - Inbox */}
          <div className="flex items-center">
            <Link href={TAB_ROUTES.todos} prefetch className={navLinkClassName(activeTab === "todos")}>
              <Inbox className="h-4 w-4" />
              {t("inbox")}
            </Link>
          </div>

          <PipeSeparator />

          {/* Group 2: Workflow - Ideate, Think, Run */}
          <div className="flex items-center gap-1">
            <Link href={TAB_ROUTES.seeds} prefetch className={navLinkClassName(activeTab === "seeds")}>
              <Sprout className="h-4 w-4" />
              {t("seeds")}
            </Link>
            <Link href={TAB_ROUTES.plan} prefetch className={navLinkClassName(activeTab === "plan")}>
              <Sparkles className="h-4 w-4" />
              {t("plan")}
            </Link>
            <Link href={TAB_ROUTES.boards} prefetch className={navLinkClassName(activeTab === "boards")}>
              <KanbanSquare className="h-4 w-4" />
              {t("boards")}
            </Link>
          </div>

          <PipeSeparator />

          {/* Group 3: Resources - Brain dropdown + Agents */}
          <div className="flex items-center gap-1">
            {!brainHidden && hasBrainItems && (
              <NavDropdownMenu
                triggerIcon={Brain}
                triggerLabel={t("brain")}
                items={brainItems}
                activeTab={activeTab}
                align="center"
                showTriggerBadge={showBrainBetaBadge}
                isTriggerActiveOverride={isBrainActive}
              />
            )}
            <Link href={TAB_ROUTES.notes} prefetch className={navLinkClassName(activeTab === "notes")}>
              <NotebookTabs className="h-4 w-4" />
              {t("notes")}
            </Link>
            {!agentsHidden && (
              <Link href={TAB_ROUTES.agents} prefetch className={navLinkClassName(activeTab === "agents")}>
                <Bot className="h-4 w-4" />
                {t("agents")}
              </Link>
            )}
          </div>
        </nav>

        <div className="flex items-center justify-end gap-2 shrink-0">
          {/* Feedback. This container renders the desktop tab AND owns the
              `open-feedback` listener that the mobile sidebar button above
              dispatches, so it has to stay mounted on every dashboard route —
              which is exactly what this bar does. */}
          <FeedbackWidgetContainer />
          {/* Notification hub: indicators clustered around the bell */}
          <div className="flex items-center gap-0.5">
            <PendingQuestionsContainer />
            <UsageNavButtonContainer />
            <NotificationBellContainer />
          </div>
          {/* Extension point for downstream distributions — see
              src/cloud/dashboard-nav-extra-actions.tsx. Inert by default. */}
          <DashboardNavExtraActions />
          <TopNavUserAvatar />
        </div>
      </div>
    </div>
  );
};
