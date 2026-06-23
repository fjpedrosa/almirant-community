"use client";

import { useConnectionUsage } from "../../application/hooks/use-connection-usage";
import { useRelativeTime } from "../../application/hooks/use-relative-time";
import { useResetTimer } from "../../application/hooks/use-reset-timer";
import { ConnectionUsageRow } from "../components/connection-usage-row";
import type { ProviderType, ProviderConnection } from "../../domain/types";

interface ConnectionUsageRowContainerProps {
  connection: ProviderConnection;
  provider: ProviderType;
}

export const ConnectionUsageRowContainer: React.FC<ConnectionUsageRowContainerProps> = ({
  connection,
  provider,
}) => {
  const { usage, isLoading, isRefreshing, refreshUsage, dataUpdatedAt } = useConnectionUsage(connection.id, provider);
  const lastRefreshedRelative = useRelativeTime(dataUpdatedAt);

  const fiveHourTimer = useResetTimer(usage?.oauthUsage?.fiveHour?.resetsAt ?? null);
  const sevenDayTimer = useResetTimer(usage?.oauthUsage?.sevenDay?.resetsAt ?? null);
  const sevenDayOpusTimer = useResetTimer(usage?.oauthUsage?.sevenDayOpus?.resetsAt ?? null);
  const sevenDaySonnetTimer = useResetTimer(usage?.oauthUsage?.sevenDaySonnet?.resetsAt ?? null);

  const timers = usage?.oauthUsage
    ? {
        fiveHour: fiveHourTimer,
        sevenDay: sevenDayTimer,
        sevenDayOpus: sevenDayOpusTimer,
        sevenDaySonnet: sevenDaySonnetTimer,
      }
    : undefined;

  return (
    <ConnectionUsageRow
      connection={connection}
      usage={usage}
      isLoading={isLoading}
      timers={timers}
      onRefresh={refreshUsage}
      isRefreshing={isRefreshing}
      lastRefreshedRelative={lastRefreshedRelative}
    />
  );
};
