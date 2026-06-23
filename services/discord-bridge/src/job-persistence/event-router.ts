import {
  createApiPersistenceStrategy,
  type EventPersistenceStrategy,
} from "@almirant/bridge-core";
import type { ApiClient } from "./api-client";
import type { Logger } from "../platform/logger";

export const createEventPersistenceStrategy = (
  apiClient: ApiClient,
  log: Logger,
): EventPersistenceStrategy =>
  createApiPersistenceStrategy({
    apiClient,
    log,
    persistSessionEvents: false,
  });
