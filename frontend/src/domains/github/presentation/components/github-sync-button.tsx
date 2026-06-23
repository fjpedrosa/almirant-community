"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw } from "lucide-react";
import type { GithubSyncButtonProps } from "../../domain/types";

const formatLastSync = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

export const GithubSyncButton: React.FC<GithubSyncButtonProps> = ({
  onSync,
  isSyncing,
  linkedRepoCount,
  lastSyncAt,
}) => {
  const t = useTranslations("github");
  const noRepos = linkedRepoCount === 0;
  const disabled = isSyncing || noRepos;

  const tooltipText = noRepos
    ? "No repositories linked to this project"
    : isSyncing
      ? "Syncing GitHub data..."
      : lastSyncAt
        ? `Last synced ${formatLastSync(lastSyncAt)}`
        : "Sync GitHub data";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              disabled={disabled}
              aria-label={isSyncing ? "Syncing GitHub data" : "Sync GitHub data"}
            >
              <span
                className={`mr-2 h-2 w-2 rounded-full ${
                  noRepos
                    ? "bg-muted-foreground"
                    : isSyncing
                      ? "bg-yellow-500 animate-pulse"
                      : "bg-green-500"
                }`}
                aria-hidden="true"
              />
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {isSyncing ? t("syncing") : t("sync")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
