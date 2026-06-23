import {
  createApiPersistenceStrategy,
  createBridgeApiClient,
  type BridgeApiClient,
  type BridgeApiClientConfig,
  type EventPersistenceStrategy,
  type SessionEventBatcher,
  type NativeEventBatcher,
} from "@almirant/bridge-core";

export type ApiClientConfig = BridgeApiClientConfig;
export type ApiClient = BridgeApiClient;
export type { EventPersistenceStrategy, SessionEventBatcher, NativeEventBatcher };

export const createApiClient = (config: ApiClientConfig): ApiClient =>
  createBridgeApiClient(config);

export const createEventPersistenceStrategy = (
  apiClient: ApiClient,
  log: ApiClientConfig["log"],
): EventPersistenceStrategy =>
  createApiPersistenceStrategy({
    apiClient,
    log,
    persistSessionEvents: true,
    persistNativeEvents: true,
  });
