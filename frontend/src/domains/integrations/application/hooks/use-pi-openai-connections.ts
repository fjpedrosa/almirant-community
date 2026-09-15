"use client";

import { useMemo } from "react";
import type { ProviderConnection } from "../../domain/types";
import { useConnections } from "./use-connections";

export const isEligiblePiOpenAiSubscriptionConnection = (
  connection: ProviderConnection,
): boolean =>
  connection.provider === "openai" &&
  connection.category === "ai" &&
  connection.isActive &&
  connection.suspendedAt === null &&
  connection.orchestrationEnabled &&
  (connection.config?.authMethod === "oauth" ||
    connection.config?.authMethod === "subscription");

/** Public-metadata-only connection options for Pi/OpenAI selectors. */
export const usePiOpenAiSubscriptionConnections = () => {
  const params = useMemo(() => {
    const value = new URLSearchParams();
    value.set("provider", "openai");
    value.set("category", "ai");
    value.set("isActive", "true");
    return value;
  }, []);
  const query = useConnections(params);
  const eligibleConnections = useMemo(
    () => (query.data ?? []).filter(isEligiblePiOpenAiSubscriptionConnection),
    [query.data],
  );

  return { ...query, data: eligibleConnections };
};
