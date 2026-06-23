"use client";

import { useTranslations } from "next-intl";
import { formatDuration } from "../../domain/formatters";
import { useUsageSummary } from "../../application/hooks/use-usage-summary";
import { UsageDrawerContent } from "../components/usage-drawer-content";
import { UsageAccountCardContainer } from "./usage-account-card-container";
import type {
  PacingStatus,
  UsageAccountCardData,
  UsageDrawerContainerProps,
  UsageSummaryAccount,
  UsageSummaryWindowKey,
} from "../../domain/types";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  zai: "z.ai",
  xai: "xAI",
};

const WINDOW_LABEL_KEYS: Record<UsageSummaryWindowKey, string> = {
  fiveHour: "sessionWindow",
  sevenDay: "weeklyWindow",
  sevenDayOpus: "opusWeeklyWindow",
  sevenDaySonnet: "sonnetWeeklyWindow",
};

const STATUS_LABEL_KEYS: Record<PacingStatus, string> = {
  ahead: "ahead",
  "on-track": "onTrack",
  behind: "behind",
};

const formatDeviation = (
  deviationPercent: number,
  t: ReturnType<typeof useTranslations<"providerUsagePanel">>,
): string => {
  const rounded = Math.round(Math.abs(deviationPercent));

  if (rounded <= 2) {
    return t("onPace");
  }

  if (deviationPercent > 0) {
    return t("deficit", { percent: rounded });
  }

  return t("inReservoir", { percent: rounded });
};

const toUsageAccountCard = (
  account: UsageSummaryAccount,
  t: ReturnType<typeof useTranslations<"providerUsagePanel">>,
): UsageAccountCardData => {
  return {
    id: account.connectionId,
    provider: account.provider,
    providerLabel: PROVIDER_LABELS[account.provider] ?? account.provider,
    name: account.name,
    accountIdentifier:
      account.usage.oauthUsage?.providerStatus?.accountIdentifier ??
      account.accountIdentifier,
    providerStatus: account.usage.oauthUsage?.providerStatus,
    source: account.usage.source,
    tokens: account.usage.totals.totalTokens,
    requests: account.usage.totals.requests,
    costUsd: account.usage.totals.costUsd,
    windows: account.windows.map((window) => ({
      id: `${account.connectionId}-${window.key}`,
      label: t(WINDOW_LABEL_KEYS[window.key]),
      percent: window.pacing.actualPercent,
      formattedTimeLeft: formatDuration(window.hoursUntilReset),
      isExpired: window.hoursUntilReset <= 0,
      expectedPercent: window.pacing.expectedPercent,
      status: window.pacing.status,
      statusLabel: t(STATUS_LABEL_KEYS[window.pacing.status]),
      deviationLabel: formatDeviation(window.pacing.deviationPercent, t),
    })),
  };
};

export const UsageDrawerContainer: React.FC<UsageDrawerContainerProps> = ({
  open,
  onOpenChange,
}) => {
  const t = useTranslations("providerUsagePanel");
  const { accounts, isLoading, dataUpdatedAt } = useUsageSummary({ enabled: open });
  const accountCards = accounts.map((account) => toUsageAccountCard(account, t));

  return (
    <UsageDrawerContent
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      isLoading={isLoading}
      isEmpty={accountCards.length === 0}
      emptyTitle={t("noProviders")}
      emptyDescription={t("noProvidersHint")}
      manageConnectionsHref="/settings/integrations"
      manageConnectionsLabel={t("manageConnections")}
    >
      {accountCards.map((account) => (
        <UsageAccountCardContainer
          key={account.id}
          account={account}
          summaryDataUpdatedAt={dataUpdatedAt}
          usageUnavailableLabel={t("usageUnavailable")}
          adminKeyRequiredLabel={t("adminKeyRequired")}
          tokensLabel={t("tokens")}
          requestsLabel={t("requests")}
        />
      ))}
    </UsageDrawerContent>
  );
};
