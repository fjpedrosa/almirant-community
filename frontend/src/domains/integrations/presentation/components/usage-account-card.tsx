import { BrainCircuit, RefreshCw } from "lucide-react";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UtilizationMeter } from "./utilization-meter";
import { formatCost, formatTokens } from "../../domain/formatters";
import type { UsageAccountCardProps } from "../../domain/types";

const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const PROVIDER_ICONS: Record<string, React.FC<{ className?: string }>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  zai: ZAIIcon,
  xai: XAIIcon,
};

const formatPlanLabel = (planType: string | null): string => {
  if (!planType) return "ChatGPT";
  return `ChatGPT ${planType.charAt(0).toUpperCase()}${planType.slice(1)}`;
};

const formatStatusLabel = (status: NonNullable<UsageAccountCardProps["account"]["providerStatus"]>): string => {
  if (status.limitReached) return "Limit reached";
  if (status.allowed === false) return "Unavailable";
  return "Available";
};

export const UsageAccountCard: React.FC<UsageAccountCardProps> = ({
  account,
  usageUnavailableLabel,
  adminKeyRequiredLabel,
  tokensLabel,
  requestsLabel,
  onRefresh,
  isRefreshing,
  lastRefreshedLabel,
}) => {
  const Icon = PROVIDER_ICONS[account.provider] ?? BrainCircuit;
  const providerStatus = account.providerStatus;

  return (
    <div className="rounded-lg border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {account.name}
            </p>
            {account.accountIdentifier && (
              <p className="truncate text-xs font-mono text-muted-foreground">
                {account.accountIdentifier}
              </p>
            )}
            {providerStatus && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">
                  {formatPlanLabel(providerStatus.planType)}
                </span>
                <Badge
                  variant={providerStatus.limitReached ? "destructive" : "outline"}
                  className="h-4 px-1.5 text-[10px]"
                >
                  {formatStatusLabel(providerStatus)}
                </Badge>
              </div>
            )}
          </div>
        </div>
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={isRefreshing ? "Refreshing" : "Refresh"}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-2.5">
        {account.windows.length > 0 ? (
          account.windows.map((window) => (
            <UtilizationMeter
              key={window.id}
              label={window.label}
              percent={window.percent}
              formattedTimeLeft={window.formattedTimeLeft}
              isExpired={window.isExpired}
              expectedPercent={window.expectedPercent}
              pacingLabel={window.deviationLabel}
            />
          ))
        ) : account.source === "admin_api" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatTokens(account.tokens)} {tokensLabel}</span>
            <span>{formatCost(account.costUsd)}</span>
            {account.requests > 0 && (
              <span>
                {account.requests.toLocaleString()} {requestsLabel}
              </span>
            )}
          </div>
        ) : account.source === "admin_key_required" ? (
          <p className="text-xs text-muted-foreground">{adminKeyRequiredLabel}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{usageUnavailableLabel}</p>
        )}
      </div>

      {lastRefreshedLabel && (
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          {lastRefreshedLabel}
        </p>
      )}
    </div>
  );
};
