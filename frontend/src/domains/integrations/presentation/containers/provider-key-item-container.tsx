"use client";

import { useConnectionUsage } from "../../application/hooks/use-connection-usage";
import { ProviderKeyItem } from "../components/provider-key-item";
import type { ProviderKeyItemProps, ProviderType } from "../../domain/types";

interface ProviderKeyItemContainerProps
  extends Omit<
    ProviderKeyItemProps,
    "usage" | "isLoadingUsage" | "isRefreshingUsage" | "onRefreshUsage"
  > {
  provider: ProviderType;
}

export const ProviderKeyItemContainer: React.FC<ProviderKeyItemContainerProps> = ({
  provider,
  ...props
}) => {
  const {
    usage,
    isLoading: isLoadingUsage,
    isRefreshing: isRefreshingUsage,
    refreshUsage,
  } = useConnectionUsage(
    props.connection.id,
    provider,
  );

  return (
    <ProviderKeyItem
      {...props}
      usage={usage}
      isLoadingUsage={isLoadingUsage}
      isRefreshingUsage={isRefreshingUsage}
      onRefreshUsage={refreshUsage}
    />
  );
};
