import Link from "next/link";
import { cn } from "@/lib/utils";
import { FlaskConical, Lock, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Badge displayed on feature-flagged (beta) items.
 */
export const FeatureFlagBadge: React.FC = () => (
  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400">
    <FlaskConical className="size-2.5" />
    Beta
  </span>
);

/**
 * Badge displayed on internal-only items.
 */
export const InternalBadge: React.FC = () => (
  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
    <Lock className="size-2.5" />
    Internal
  </span>
);

/**
 * A single item in the NavDropdownMenu.
 */
export interface NavDropdownMenuItem {
  /** Unique identifier for this item (used as React key and for active matching). */
  id: string;
  /** Icon component from lucide-react. */
  icon: LucideIcon;
  /** Display label for the item. */
  label: string;
  /** Navigation href for the link. */
  href: string;
  /** If true, this item is hidden (e.g., due to feature flag being off). */
  hidden?: boolean;
  /** If true, shows a "Beta" badge next to the label. */
  isBeta?: boolean;
  /** If true, shows an "Internal" badge next to the label. */
  isInternal?: boolean;
}

export interface NavDropdownMenuProps {
  /** Icon component for the trigger button. */
  triggerIcon: LucideIcon;
  /** Label text for the trigger button. */
  triggerLabel: string;
  /** Array of menu items to display. */
  items: NavDropdownMenuItem[];
  /** Currently active tab/route id — used to highlight active items and trigger. */
  activeTab: string;
  /** Alignment of the dropdown content relative to trigger. Default: "center". */
  align?: "start" | "center" | "end";
  /** Width class for the dropdown content. Default: "w-48". */
  contentClassName?: string;
  /** If true, shows the Beta badge on the trigger button. */
  showTriggerBadge?: boolean;
  /** Override for trigger active state (e.g., for Brain dropdown which should be active on /docs or /ask). */
  isTriggerActiveOverride?: boolean;
}

/**
 * A reusable navigation dropdown menu component for the top navigation bar.
 *
 * This is a purely presentational component — all state (activeTab) is passed as props.
 * It supports:
 * - Trigger with icon and label
 * - Items with icons, labels, hrefs, and optional beta badges
 * - Hiding items via the `hidden` property (for feature flags)
 * - Active item highlighting based on `activeTab`
 * - Keyboard accessibility (inherits from shadcn DropdownMenu / Radix)
 *
 * @example
 * ```tsx
 * const items: NavDropdownMenuItem[] = [
 *   { id: "projects", icon: FolderKanban, label: "Projects", href: "/projects" },
 *   { id: "roadmap", icon: Map, label: "Roadmap", href: "/roadmap", isBeta: true },
 *   { id: "goals", icon: Target, label: "Goals", href: "/goals", hidden: !hasGoalsFeature },
 * ];
 *
 * <NavDropdownMenu
 *   triggerIcon={MoreHorizontal}
 *   triggerLabel="More"
 *   items={items}
 *   activeTab={currentTab}
 * />
 * ```
 */
export const NavDropdownMenu: React.FC<NavDropdownMenuProps> = ({
  triggerIcon: TriggerIcon,
  triggerLabel,
  items,
  activeTab,
  align = "center",
  contentClassName,
  showTriggerBadge = false,
  isTriggerActiveOverride,
}) => {
  // Filter out hidden items
  const visibleItems = items.filter((item) => !item.hidden);

  // Determine if trigger should be highlighted (any visible item is active, or overridden)
  const isTriggerActive =
    isTriggerActiveOverride ?? visibleItems.some((item) => item.id === activeTab);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            isTriggerActive
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <TriggerIcon className="h-4 w-4" />
          {triggerLabel}
          {showTriggerBadge && <FeatureFlagBadge />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn("w-48", contentClassName)}>
        {visibleItems.map((item) => {
          const ItemIcon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <DropdownMenuItem key={item.id} asChild>
              <Link
                href={item.href}
                prefetch
                className={cn(
                  "flex items-center gap-2 cursor-pointer",
                  isActive && "bg-primary/15 text-primary"
                )}
              >
                <ItemIcon className="h-4 w-4" />
                {item.label}
                {item.isBeta && <FeatureFlagBadge />}
                {item.isInternal && <InternalBadge />}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
