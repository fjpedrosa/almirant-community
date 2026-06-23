import type { Sql } from "postgres";
import { createOpenCodeSessionEventsBackfill } from "./opencode-session-events";
import {
  runDataBackfillsWithPostgres,
  type DataBackfillDefinition,
  type DataBackfillRunResult,
  type RunDataBackfillsOptions,
} from "./runner";

export const createRegisteredDataBackfills = (sql: Sql): DataBackfillDefinition[] => [
  createOpenCodeSessionEventsBackfill(sql),
];

export const runRegisteredDataBackfills = async (
  databaseUrl: string,
  options: RunDataBackfillsOptions = {},
): Promise<DataBackfillRunResult[]> =>
  runDataBackfillsWithPostgres(databaseUrl, createRegisteredDataBackfills, options);
