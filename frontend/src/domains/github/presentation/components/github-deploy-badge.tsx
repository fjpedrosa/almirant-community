"use client";

import { Badge } from "@/components/ui/badge";
import type { GithubDeployBadgeProps, GithubCiStatus } from "../../domain/types";

// ---- Status mapping ---------------------------------------------------------

const deployConfig: Record<
  GithubCiStatus,
  { dotClass: string; label: string; badgeVariant: "default" | "secondary" | "outline" }
> = {
  success: { dotClass: "bg-green-500", label: "Deployed", badgeVariant: "secondary" },
  failure: { dotClass: "bg-red-500", label: "Failed", badgeVariant: "secondary" },
  pending: { dotClass: "bg-yellow-500", label: "Pending", badgeVariant: "secondary" },
  queued: { dotClass: "bg-yellow-500", label: "Queued", badgeVariant: "secondary" },
  in_progress: { dotClass: "bg-yellow-500", label: "Deploying", badgeVariant: "secondary" },
  cancelled: { dotClass: "bg-gray-400", label: "Cancelled", badgeVariant: "outline" },
  skipped: { dotClass: "bg-gray-400", label: "Skipped", badgeVariant: "outline" },
  neutral: { dotClass: "bg-gray-400", label: "Neutral", badgeVariant: "outline" },
};

// ---- Component --------------------------------------------------------------

export const GithubDeployBadge: React.FC<GithubDeployBadgeProps> = ({ status }) => {
  if (!status) {
    return (
      <Badge variant="outline" className="gap-1.5 text-xs">
        <span className="h-2 w-2 rounded-full bg-gray-400" aria-hidden="true" />
        No deploys
      </Badge>
    );
  }

  const config = deployConfig[status];

  return (
    <Badge variant={config.badgeVariant} className="gap-1.5 text-xs">
      <span
        className={`h-2 w-2 rounded-full ${config.dotClass}`}
        aria-hidden="true"
      />
      <span role="status" aria-label={`Deploy status: ${config.label}`}>
        {config.label}
      </span>
    </Badge>
  );
};
