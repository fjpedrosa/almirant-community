"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BarChart3, FolderKanban, LibraryBig, LogOut, Map, Receipt, Settings, Target, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "./user-avatar";
import { FeatureFlagBadge } from "./nav-dropdown-menu";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { usePostHogFeatureFlag } from "@/domains/shared/application/hooks/use-posthog-feature-flag";

export const TopNavUserAvatar: React.FC = () => {
  const { user, signOut } = useAuth();
  const t = useTranslations("profileMenu");

  const [menuOpen, setMenuOpen] = useState(false);
  const showExpenses = usePostHogFeatureFlag("beta-expenses").enabled;
  const showRoadmap = usePostHogFeatureFlag("beta-roadmap").enabled;
  const showGoals = usePostHogFeatureFlag("beta-goals").enabled;

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Open profile menu"
        >
          <UserAvatar
            name={user?.name}
            email={user?.email}
            imageUrl={user?.image}
            className="size-8"
            imageAlt={user?.name ? `${user.name} avatar` : "User avatar"}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuLabel className="py-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-none truncate">
              {user?.name ?? "User"}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {user?.email ?? ""}
            </span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/handbook" className="flex items-center gap-2">
              <LibraryBig className="h-4 w-4" />
              {t("handbook")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/teams" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Teams
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/projects" className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4" />
              {t("projects")}
            </Link>
          </DropdownMenuItem>
          {showExpenses && (
            <DropdownMenuItem asChild>
              <Link href="/expenses" className="flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                {t("expenses")}
                <FeatureFlagBadge />
              </Link>
            </DropdownMenuItem>
          )}
          {showRoadmap && (
            <DropdownMenuItem asChild>
              <Link href="/roadmap" className="flex items-center gap-2">
                <Map className="h-4 w-4" />
                {t("roadmap")}
                <FeatureFlagBadge />
              </Link>
            </DropdownMenuItem>
          )}
          {showGoals && (
            <DropdownMenuItem asChild>
              <Link href="/goals" className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                {t("goals")}
                <FeatureFlagBadge />
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              {t("settings")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/analytics" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {t("analytics")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => {
            e.preventDefault();
            void signOut();
          }}
        >
          <LogOut className="h-4 w-4" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
