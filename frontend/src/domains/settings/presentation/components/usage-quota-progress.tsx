interface QuotaItem {
  provider: string;
  periodType: string;
  maxTokens: number | null;
  maxCostUsd: number | null;
  maxRequests: number | null;
  usedTokens: number;
  usedCostUsd: number;
  usedRequests: number;
  percentTokens: number | null;
  percentCost: number | null;
  percentRequests: number | null;
  periodEnd: string | null;
}

interface UsageQuotaProgressProps {
  quotas: QuotaItem[];
}

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString();
};

const getProgressColor = (percent: number): string => {
  if (percent >= 100) return "bg-destructive";
  if (percent >= 90) return "bg-orange-500";
  if (percent >= 75) return "bg-yellow-500";
  return "bg-primary";
};

export function UsageQuotaProgress({ quotas }: UsageQuotaProgressProps) {
  if (quotas.length === 0) return null;

  return (
    <div className="space-y-4">
      {quotas.map((quota) => {
        const key = `${quota.provider}-${quota.periodType}`;
        const providerLabel = quota.provider.charAt(0).toUpperCase() + quota.provider.slice(1);
        const periodLabel = quota.periodType.charAt(0).toUpperCase() + quota.periodType.slice(1);

        const metrics: Array<{ label: string; used: string; max: string; percent: number }> = [];

        if (quota.maxTokens !== null && quota.percentTokens !== null) {
          metrics.push({
            label: "Tokens",
            used: formatTokens(quota.usedTokens),
            max: formatTokens(quota.maxTokens),
            percent: quota.percentTokens,
          });
        }

        if (quota.maxCostUsd !== null && quota.percentCost !== null) {
          metrics.push({
            label: "Cost",
            used: `$${quota.usedCostUsd.toFixed(2)}`,
            max: `$${quota.maxCostUsd.toFixed(2)}`,
            percent: quota.percentCost,
          });
        }

        if (quota.maxRequests !== null && quota.percentRequests !== null) {
          metrics.push({
            label: "Requests",
            used: quota.usedRequests.toLocaleString(),
            max: quota.maxRequests.toLocaleString(),
            percent: quota.percentRequests,
          });
        }

        if (metrics.length === 0) return null;

        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{providerLabel}</span>
              <span className="text-xs text-muted-foreground">{periodLabel}</span>
            </div>
            {metrics.map((metric) => (
              <div key={`${key}-${metric.label}`} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{metric.label}</span>
                  <span>
                    {metric.used} / {metric.max} ({metric.percent.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
                  <div
                    className={`h-full rounded-full transition-all ${getProgressColor(metric.percent)}`}
                    style={{ width: `${Math.min(metric.percent, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
