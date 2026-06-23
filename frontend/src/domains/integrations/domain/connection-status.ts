import type {
  IntegrationConnectionStatus,
  ProviderConnection,
  ProviderType,
} from "./types";

const AUTO_REFRESH_PROVIDERS: ProviderType[] = ["github", "vercel"];

const canAutoRefreshConnection = (connection: ProviderConnection): boolean => {
  if (AUTO_REFRESH_PROVIDERS.includes(connection.provider)) {
    return true;
  }

  return connection.config?.authMethod === "oauth";
};

export const deriveIntegrationConnectionStatus = (
  connection: ProviderConnection | undefined,
): IntegrationConnectionStatus => {
  if (!connection) return "disconnected";

  if (connection.suspendedAt) return "suspended";

  if (connection.lastValidationStatus === "invalid") return "inactive";

  if (connection.tokenExpiresAt && !canAutoRefreshConnection(connection)) {
    const expiresAt = new Date(connection.tokenExpiresAt);
    if (expiresAt < new Date()) return "expired";
  }

  if (connection.isActive) return "connected";

  return "inactive";
};
