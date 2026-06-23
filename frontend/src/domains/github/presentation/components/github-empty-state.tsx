import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Github, Link, RefreshCw } from "lucide-react";
import type { GithubEmptyStateProps } from "../../domain/types";

const config = {
  not_connected: {
    icon: Github,
    title: "GitHub not connected",
    description:
      "Connect your GitHub account in Settings to sync repositories, pull requests, and commits.",
  },
  no_repos_linked: {
    icon: Link,
    title: "No repositories linked",
    description:
      "Add repositories to this project and they will be automatically linked to your GitHub installation.",
  },
  not_synced: {
    icon: RefreshCw,
    title: "Ready to sync",
    description:
      "Your repositories are linked. Sync now to fetch pull requests, commits, and workflow data from GitHub.",
  },
} as const;

export const GithubEmptyState: React.FC<GithubEmptyStateProps> = ({
  status,
  onSync,
  isSyncing,
}) => {
  const { icon: Icon, title, description } = config[status];

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-medium mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-4">
          {description}
        </p>
        {status === "not_synced" && onSync && (
          <Button onClick={onSync} disabled={isSyncing} size="sm">
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {isSyncing ? "Syncing..." : "Sync now"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
