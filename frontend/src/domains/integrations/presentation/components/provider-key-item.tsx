"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Crown,
  Info,
  Key,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  TestTube,
  Trash2,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState } from "react";
import { formatTokens, formatCost } from "../../domain/formatters";
import type {
  ProviderKeyItemProps,
  ConnectionUsageData,
  OAuthUsageData,
  OpenAiProviderUsageData,
} from "../../domain/types";
import { OAuthUsageDisplay } from "./oauth-usage-display";
import { useResetTimer } from "../../application/hooks/use-reset-timer";

const formatLastUsed = (value: string | null): string => {
  if (!value) return "Never used";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never used";
  return parsed.toLocaleString();
};

const hasRenderableOAuthUsage = (oauthUsage: OAuthUsageData): boolean => {
  return Boolean(
    oauthUsage.fiveHour ||
      oauthUsage.sevenDay ||
      oauthUsage.sevenDayOpus ||
      oauthUsage.sevenDaySonnet ||
      oauthUsage.providerStatus ||
      oauthUsage.extraUsage.isEnabled,
  );
};

const OAuthUsageInline: React.FC<{ oauthUsage: OAuthUsageData }> = ({ oauthUsage }) => {
  const fiveHourTimer = useResetTimer(oauthUsage.fiveHour?.resetsAt ?? null);
  const sevenDayTimer = useResetTimer(oauthUsage.sevenDay?.resetsAt ?? null);
  const sevenDayOpusTimer = useResetTimer(oauthUsage.sevenDayOpus?.resetsAt ?? null);
  const sevenDaySonnetTimer = useResetTimer(oauthUsage.sevenDaySonnet?.resetsAt ?? null);

  return (
    <OAuthUsageDisplay
      oauthUsage={oauthUsage}
      timers={{
        fiveHour: fiveHourTimer,
        sevenDay: sevenDayTimer,
        sevenDayOpus: sevenDayOpusTimer,
        sevenDaySonnet: sevenDaySonnetTimer,
      }}
    />
  );
};

const OpenAiUsageInline: React.FC<{
  usage: ConnectionUsageData;
  openaiUsage: OpenAiProviderUsageData;
}> = ({ usage, openaiUsage }) => {
  const [expanded, setExpanded] = useState(false);
  const topModel = openaiUsage.models[0] ?? null;
  const hasCachedTokens = openaiUsage.models.some(
    (model) => model.cachedInputTokens > 0,
  );
  const showEstimatedCostNote =
    openaiUsage.models.some((model) => model.estimatedCostUsd !== null) &&
    openaiUsage.billedCostUsd !== null;

  const summaryParts = [
    `${formatTokens(usage.totals.totalTokens)} tokens`,
    formatCost(usage.totals.costUsd),
  ];

  if (topModel) {
    summaryParts.push(`${topModel.model} top model`);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <BarChart3 className="h-3 w-3 shrink-0" />
        <span>{summaryParts.join(" · ")}</span>
        <ChevronRight
          className={cn(
            "ml-auto h-3 w-3 shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 pl-5 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border bg-muted/20 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Input
              </p>
              <p className="mt-1 font-medium">
                {formatTokens(usage.totals.inputTokens)}
              </p>
            </div>
            <div className="rounded-md border bg-muted/20 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Output
              </p>
              <p className="mt-1 font-medium">
                {formatTokens(usage.totals.outputTokens)}
              </p>
            </div>
            <div className="rounded-md border bg-muted/20 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Requests
              </p>
              <p className="mt-1 font-medium">
                {usage.totals.requests.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border bg-muted/20 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Cost
              </p>
              <p className="mt-1 font-medium">{formatCost(usage.totals.costUsd)}</p>
            </div>
          </div>

          {topModel && (
            <div className="rounded-md border bg-muted/20 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Most used model
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-medium">{topModel.model}</span>
                <span className="text-muted-foreground">
                  {formatTokens(topModel.totalTokens)} ·{" "}
                  {topModel.requests.toLocaleString()} req
                </span>
              </div>
            </div>
          )}

          <div className="space-y-1.5 rounded-md border bg-muted/10 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Model breakdown
            </p>
            {openaiUsage.models.map((model) => (
              <div
                key={model.model}
                className="flex items-start justify-between gap-3 rounded-sm py-1"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{model.model}</p>
                  <p className="text-muted-foreground">
                    {formatTokens(model.totalTokens)} total ·{" "}
                    {model.requests.toLocaleString()} req
                    {model.cachedInputTokens > 0
                      ? ` · ${formatTokens(model.cachedInputTokens)} cached`
                      : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-medium">
                    {model.estimatedCostUsd === null
                      ? "N/A"
                      : formatCost(model.estimatedCostUsd)}
                  </p>
                  <p className="text-muted-foreground">estimated</p>
                </div>
              </div>
            ))}
          </div>

          {showEstimatedCostNote && (
            <p className="text-[10px] text-muted-foreground">
              Total cost comes from OpenAI billing. Per-model costs are estimated from model pricing.
            </p>
          )}
          {hasCachedTokens && (
            <p className="text-[10px] text-muted-foreground">
              Cached prompt tokens are tracked separately and excluded from per-model cost estimates.
            </p>
          )}
          {usage.period && (
            <p className="pt-0.5 text-[10px] text-muted-foreground">
              {usage.period.startDate} — {usage.period.endDate}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const UsageInline: React.FC<{
  usage: ConnectionUsageData | null;
  isLoading: boolean;
  isLegacyAnthropicSetupToken: boolean;
}> = ({ usage, isLoading, isLegacyAnthropicSetupToken }) => {
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <BarChart3 className="h-3 w-3 shrink-0" />
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (isLegacyAnthropicSetupToken) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-medium">Reconnect this Anthropic key as Subscription</p>
          <p className="text-amber-900/80">
            Legacy setup tokens cannot show the Claude usage percentage bars.
          </p>
        </div>
      </div>
    );
  }

  if (!usage || !usage.supported || usage.source === "not_available") return null;

  if (usage.source === "admin_key_required") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3 w-3 shrink-0" />
        <span>Admin API Key required for usage data</span>
      </div>
    );
  }

  if (usage.source === "error") {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive/70">
        <Info className="h-3 w-3 shrink-0" />
        <span>Failed to load usage</span>
      </div>
    );
  }

  if (usage.source === "oauth_usage") {
    if (!usage.oauthUsage || !hasRenderableOAuthUsage(usage.oauthUsage)) {
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          <span>Usage data unavailable</span>
        </div>
      );
    }
    return <OAuthUsageInline oauthUsage={usage.oauthUsage} />;
  }

  if (usage.providerUsage?.openai) {
    return (
      <OpenAiUsageInline
        usage={usage}
        openaiUsage={usage.providerUsage.openai}
      />
    );
  }

  // Default: admin_api source
  const summary = `${formatTokens(usage.totals.totalTokens)} tokens · ${formatCost(usage.totals.costUsd)}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <BarChart3 className="h-3 w-3 shrink-0" />
        <span>{summary}</span>
        <ChevronRight
          className={cn(
            "ml-auto h-3 w-3 transition-transform shrink-0",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 pl-5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Input tokens</span>
            <span className="font-medium">{formatTokens(usage.totals.inputTokens)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Output tokens</span>
            <span className="font-medium">{formatTokens(usage.totals.outputTokens)}</span>
          </div>
          <div className="flex items-center justify-between border-t pt-1.5">
            <span className="text-muted-foreground">Total tokens</span>
            <span className="font-medium">{formatTokens(usage.totals.totalTokens)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-medium">{formatCost(usage.totals.costUsd)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Requests</span>
            <span className="font-medium">{usage.totals.requests.toLocaleString()}</span>
          </div>
          {usage.period && (
            <p className="text-[10px] text-muted-foreground pt-0.5">
              {usage.period.startDate} — {usage.period.endDate}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const isTokenExpired = (
  tokenExpiresAt: string | null,
  authMethod: string | undefined,
): boolean => {
  if (!tokenExpiresAt) return false;
  // OAuth tokens (subscriptions) may remain valid beyond the advertised
  // expires_at, so we don't show the expired badge for them.
  if (authMethod === "oauth" || authMethod === "setup_token") return false;
  const parsed = new Date(tokenExpiresAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < Date.now();
};

export const ProviderKeyItem: React.FC<ProviderKeyItemProps> = ({
  connection,
  isDefault,
  isEditing,
  editName,
  editToken,
  onEditNameChange,
  onEditTokenChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSetDefault,
  onTest,
  onDelete,
  isSaving,
  isTesting,
  testResult,
  usage,
  isLoadingUsage,
  isRefreshingUsage,
  onRefreshUsage,
  priorityPosition,
  totalConnections,
  onMovePriorityUp,
  onMovePriorityDown,
  isReordering,
  onToggleOrchestration,
  onReconnect,
}) => {
  const isLegacyAnthropicSetupToken =
    connection.provider === "anthropic" &&
    connection.config?.authMethod === "setup_token";

  const isSuspended = Boolean(connection.suspendedAt);
  const tokenExpired = isTokenExpired(
    connection.tokenExpiresAt,
    connection.config?.authMethod as string | undefined,
  );

  return (
    <Card className={cn("transition-colors", isDefault && "ring-2 ring-primary/20 bg-primary/5")}>
      <CardHeader className="gap-3 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
              <Key className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">{connection.name}</CardTitle>
                {priorityPosition != null && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                    #{priorityPosition}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {connection.accountIdentifier || "No identifier"}
                {isDefault && (
                  <Badge variant="secondary" className="ml-2">
                    <Crown className="mr-1 h-3 w-3" />
                    Default
                  </Badge>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!isEditing && onMovePriorityUp && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onMovePriorityUp}
                    disabled={isReordering || priorityPosition === 1}
                    className="h-8 px-1.5"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Move up in priority</TooltipContent>
              </Tooltip>
            )}
            {!isEditing && onMovePriorityDown && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onMovePriorityDown}
                    disabled={isReordering || priorityPosition === totalConnections}
                    className="h-8 px-1.5"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Move down in priority</TooltipContent>
              </Tooltip>
            )}
            {!isDefault && !isEditing && (
              <Button variant="ghost" size="sm" onClick={onSetDefault} className="h-8 px-2">
                <Crown className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefreshUsage}
                disabled={isLoadingUsage || isRefreshingUsage}
                className="h-8 px-2"
                title="Refresh usage"
              >
                {isRefreshingUsage ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {!isEditing && (
              <Button variant="ghost" size="sm" onClick={onStartEdit} className="h-8 px-2">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isEditing && onReconnect && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={onReconnect} className="h-8 px-2">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Reconnect credentials</TooltipContent>
              </Tooltip>
            )}
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onTest}
                disabled={isTesting}
                className="h-8 px-2"
              >
                {isTesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <TestTube className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="h-8 px-2 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={connection.isActive ? "default" : "outline"} className="h-5 px-2 text-[10px]">
            {connection.isActive ? "Active" : "Inactive"}
          </Badge>
          {onToggleOrchestration && (
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <Switch
                    checked={connection.orchestrationEnabled}
                    onCheckedChange={onToggleOrchestration}
                    className="h-4 w-7 [&>span]:h-3 [&>span]:w-3"
                  />
                  <span className="text-[10px] text-muted-foreground">Orchestration</span>
                </label>
              </TooltipTrigger>
              <TooltipContent side="top">
                {connection.orchestrationEnabled
                  ? "This account participates in automated orchestration"
                  : "Enable to include this account in automated orchestration"}
              </TooltipContent>
            </Tooltip>
          )}
          {isSuspended && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="h-5 gap-1 px-2 text-[10px]">
                  <AlertTriangle className="h-3 w-3" />
                  Suspended
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                {connection.lastValidationError || "Connection suspended due to repeated failures"}
              </TooltipContent>
            </Tooltip>
          )}
          {tokenExpired && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="h-5 gap-1 border-amber-300 bg-amber-50 px-2 text-[10px] text-amber-700">
                  <Clock className="h-3 w-3" />
                  Token Expired
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top">
                Token expired on {new Date(connection.tokenExpiresAt as string).toLocaleString()}
              </TooltipContent>
            </Tooltip>
          )}
          {connection.lastValidationStatus === "failed" && (
            <Badge variant="outline" className="h-5 border-red-300 bg-red-50 px-2 text-[10px] text-red-700">
              Validation Failed
            </Badge>
          )}
          <span>Last used: {formatLastUsed(connection.lastUsedAt)}</span>
          {isRefreshingUsage && (
            <span className="inline-flex items-center gap-1 text-[10px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Refreshing usage...
            </span>
          )}
        </div>

        {/* Usage inline (AI providers with usage data) */}
        {(usage || isLoadingUsage || isLegacyAnthropicSetupToken) && !isEditing && (
          <UsageInline
            usage={usage}
            isLoading={isLoadingUsage}
            isLegacyAnthropicSetupToken={isLegacyAnthropicSetupToken}
          />
        )}

        {isEditing && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <Input
              value={editName}
              onChange={(event) => onEditNameChange(event.target.value)}
              placeholder="Connection name"
            />
            <Input
              type="password"
              value={editToken}
              onChange={(event) => onEditTokenChange(event.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="off"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onCancelEdit} disabled={isSaving}>
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={onSaveEdit} disabled={isSaving || editName.trim().length === 0}>
                {isSaving ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        )}

        {testResult && (
          <div className="flex items-center gap-2">
            {testResult.valid ? (
              <div className="flex items-center gap-2 text-xs text-green-600">
                <CheckCircle2 className="h-3 w-3" />
                Connection verified
              </div>
            ) : (
              <div className="text-xs text-destructive">Test failed: {testResult.error || "Unknown error"}</div>
            )}
          </div>
        )}
      </CardHeader>
    </Card>
  );
};
