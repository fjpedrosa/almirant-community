/**
 * Error Search Query helper
 *
 * Performs an `searchObservations` lookup against the agent observations store
 * scoped to `error_diagnosis` entries, bounded by an aggressive timeout so it
 * never blocks an investigation-context enqueue path.
 *
 * Contract:
 *  - Never throws. Always returns a consistent `{ status, results, durationMs }`
 *    shape so callers can embed the outcome directly into the investigation
 *    context without defensive try/catch.
 *  - Uses `Promise.race` against a `setTimeout`-backed resolve (not reject) so
 *    timeout is a graceful degradation, not an error.
 *  - Maps `ObservationSearchRow` metadata into the flat `ErrorSearchResultInfo`
 *    shape consumed by the investigation context builder.
 */
import { searchObservations } from "@almirant/database";
import {
  ERROR_SEARCH_LIMIT,
  ERROR_SEARCH_TIMEOUT_MS,
  type ErrorSearchResultInfo,
  type ErrorSearchStatus,
} from "@almirant/shared";
import { logger } from "@almirant/config";

export interface RunErrorSearchInput {
  workspaceId: string;
  projectId?: string;
  query: string;
  limit?: number;
  timeoutMs?: number;
}

export interface RunErrorSearchResult {
  status: ErrorSearchStatus;
  results: ErrorSearchResultInfo[];
  durationMs: number;
}

interface ErrorDiagnosisMetadataShape {
  area?: string | null;
  symptom?: string | null;
  rootCause?: string | null;
  fix?: string | null;
}

interface MinimalObservationRow {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
}

const mapObservationToErrorSearchResult = (
  row: MinimalObservationRow,
  projectId: string | null,
): ErrorSearchResultInfo => {
  const meta = (row.metadata ?? {}) as ErrorDiagnosisMetadataShape;
  return {
    id: row.id,
    title: row.title,
    symptom: meta.symptom ?? null,
    rootCause: meta.rootCause ?? null,
    fix: meta.fix ?? null,
    area: meta.area ?? null,
    projectId,
  };
};

type RaceResult =
  | { kind: "ok"; rows: MinimalObservationRow[] }
  | { kind: "timeout" };

export const runErrorSearchWithTimeout = async (
  input: RunErrorSearchInput,
): Promise<RunErrorSearchResult> => {
  const start = Date.now();
  const limit = input.limit ?? ERROR_SEARCH_LIMIT;
  const timeoutMs = input.timeoutMs ?? ERROR_SEARCH_TIMEOUT_MS;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const searchPromise: Promise<RaceResult> = searchObservations(
    input.workspaceId,
    input.query,
    {
      projectId: input.projectId,
      type: "error_diagnosis",
      limit,
    },
  ).then((rows) => ({ kind: "ok" as const, rows: rows as MinimalObservationRow[] }));

  const timeoutPromise = new Promise<RaceResult>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });

  try {
    const race = await Promise.race([searchPromise, timeoutPromise]);
    const durationMs = Date.now() - start;

    if (race.kind === "timeout") {
      const timeoutDurationMs = Math.max(durationMs, timeoutMs);
      logger.warn(
        { query: input.query, projectId: input.projectId, durationMs: timeoutDurationMs, timeoutMs },
        "error_search timed out",
      );
      return { status: "timeout", results: [], durationMs: timeoutDurationMs };
    }

    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }

    return {
      status: "ok",
      results: race.rows.map((row) =>
        mapObservationToErrorSearchResult(row, input.projectId ?? null),
      ),
      durationMs,
    };
  } catch (err) {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    const durationMs = Date.now() - start;
    logger.error(
      { err, query: input.query, projectId: input.projectId, durationMs },
      "error_search failed",
    );
    return { status: "error", results: [], durationMs };
  }
};
