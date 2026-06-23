import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { OAuthUsageDisplay } from "./oauth-usage-display";
import { formatTokens, formatCost } from "../../domain/formatters";
import type { ConnectionUsageRowProps } from "../../domain/types";

const maskKey = (key: string | null): string => {
  if (!key) return "";
  if (key.length <= 8) return key;
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
};

export const ConnectionUsageRow: React.FC<ConnectionUsageRowProps> = ({
  connection,
  usage,
  isLoading,
  timers,
  onRefresh,
  isRefreshing,
  lastRefreshedRelative,
}) => {
  const t = useTranslations("providerUsagePanel");

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{connection.name}</span>
          {connection.isDefault && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] shrink-0">
              Default
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {connection.accountIdentifier && (
            <span className="text-xs text-muted-foreground font-mono">
              {maskKey(connection.accountIdentifier)}
            </span>
          )}
          {onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label={isRefreshing ? t("refreshing") : "Refresh"}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          )}
        </div>
      </div>

      {/* Usage content */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-3/4" />
        </div>
      ) : !usage ? (
        <p className="text-xs text-muted-foreground">Usage data unavailable</p>
      ) : usage.source === "oauth_usage" && usage.oauthUsage && timers ? (
        <OAuthUsageDisplay oauthUsage={usage.oauthUsage} timers={timers} />
      ) : usage.source === "admin_api" ? (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatTokens(usage.totals.totalTokens)} tokens</span>
          <span>{formatCost(usage.totals.costUsd)}</span>
          {usage.totals.requests > 0 && (
            <span>{usage.totals.requests.toLocaleString()} requests</span>
          )}
        </div>
      ) : usage.source === "admin_key_required" ? (
        <p className="text-xs text-muted-foreground">Admin API key required</p>
      ) : (
        <p className="text-xs text-muted-foreground">Usage data unavailable</p>
      )}

      {/* Last refreshed timestamp */}
      {lastRefreshedRelative && !isLoading && (
        <p className="text-[10px] text-muted-foreground/70">
          {t("lastRefreshed", { time: lastRefreshedRelative })}
        </p>
      )}
    </div>
  );
};
