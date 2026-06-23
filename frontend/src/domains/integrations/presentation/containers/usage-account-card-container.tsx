"use client";

import { useTranslations } from "next-intl";
import { useUsageAccountRefresh } from "../../application/hooks/use-usage-account-refresh";
import { useRelativeTime } from "../../application/hooks/use-relative-time";
import { UsageAccountCard } from "../components/usage-account-card";
import type { UsageAccountCardData } from "../../domain/types";

interface UsageAccountCardContainerProps {
  account: UsageAccountCardData;
  summaryDataUpdatedAt: number | undefined;
  usageUnavailableLabel: string;
  adminKeyRequiredLabel: string;
  tokensLabel: string;
  requestsLabel: string;
}

export const UsageAccountCardContainer: React.FC<UsageAccountCardContainerProps> = ({
  account,
  summaryDataUpdatedAt,
  usageUnavailableLabel,
  adminKeyRequiredLabel,
  tokensLabel,
  requestsLabel,
}) => {
  const t = useTranslations("providerUsagePanel");
  const { refreshUsage, isRefreshing, dataUpdatedAt } = useUsageAccountRefresh(
    account.id,
    account.provider,
    summaryDataUpdatedAt,
  );
  const lastRefreshedRelative = useRelativeTime(dataUpdatedAt);

  const lastRefreshedLabel = lastRefreshedRelative
    ? t("lastRefreshed", { time: lastRefreshedRelative })
    : undefined;

  return (
    <UsageAccountCard
      account={account}
      usageUnavailableLabel={usageUnavailableLabel}
      adminKeyRequiredLabel={adminKeyRequiredLabel}
      tokensLabel={tokensLabel}
      requestsLabel={requestsLabel}
      onRefresh={refreshUsage}
      isRefreshing={isRefreshing}
      lastRefreshedLabel={lastRefreshedLabel}
    />
  );
};
