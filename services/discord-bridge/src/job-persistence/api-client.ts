import type { Logger } from "../platform/logger";
import {
  createBridgeApiClient,
  type BridgeApiClient,
  type BridgeApiClientConfig,
} from "@almirant/bridge-core";

export type ApiClientConfig = BridgeApiClientConfig & { log: Logger };
export type ApiClient = BridgeApiClient;

export const createApiClient = (config: ApiClientConfig): ApiClient =>
  createBridgeApiClient(config);
