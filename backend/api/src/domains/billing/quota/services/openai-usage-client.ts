import { logger } from "@almirant/config";

// ---- Constants ----

const OPENAI_ADMIN_API_BASE = "https://api.openai.com";

// ---- Error types ----

export class OpenAiAdminApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`OpenAI Admin API error ${statusCode}: ${responseBody}`);
    this.name = "OpenAiAdminApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class OpenAiAdminRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`OpenAI Admin API rate limited. Retry after ${retryAfterSeconds}s`);
    this.name = "OpenAiAdminRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---- Request parameter types ----

export interface OpenAiCompletionsUsageParams {
  /** Start time as Unix epoch seconds */
  startTime: number;
  /** End time as Unix epoch seconds */
  endTime: number;
  bucketWidth?: "1m" | "1h" | "1d";
  groupBy?: string[];
  /** Cursor for pagination */
  page?: string;
  limit?: number;
}

export interface OpenAiCostParams {
  /** Start time as Unix epoch seconds */
  startTime: number;
  /** End time as Unix epoch seconds */
  endTime: number;
  bucketWidth?: "1d";
  /** Cursor for pagination */
  page?: string;
  limit?: number;
}

// ---- Response types ----

export interface OpenAiUsageBucket {
  start_time: number;
  end_time: number;
  results: OpenAiUsageResult[];
}

export interface OpenAiUsageResult {
  object: string;
  input_tokens: number;
  output_tokens: number;
  input_cached_tokens: number;
  num_model_requests: number;
  project_id?: string;
  user_id?: string;
  api_key_id?: string;
  model?: string;
}

export interface OpenAiUsageResponse {
  object: string;
  data: OpenAiUsageBucket[];
  has_more: boolean;
  next_page: string | null;
}

export interface OpenAiCostBucket {
  start_time: number;
  end_time: number;
  results: OpenAiCostResult[];
}

export interface OpenAiCostResult {
  object: string;
  amount: {
    value: number;
    currency: string;
  };
  line_item?: string;
  project_id?: string;
}

export interface OpenAiCostResponse {
  object: string;
  data: OpenAiCostBucket[];
  has_more: boolean;
  next_page: string | null;
}

// ---- Permission error result ----

export interface OpenAiPermissionError {
  error: "insufficient_permissions";
}

type OpenAiResult<T> = T | OpenAiPermissionError;

// ---- Internal helpers ----

const isPermissionError = (status: number): boolean =>
  status === 401 || status === 403;

const makeRequest = async <T>(
  apiKey: string,
  path: string,
  params?: Record<string, string | string[]>
): Promise<OpenAiResult<T>> => {
  const url = new URL(path, OPENAI_ADMIN_API_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          url.searchParams.append(k, item);
        }
      } else {
        url.searchParams.set(k, v);
      }
    }
  }

  logger.debug({ path, params }, "OpenAI Admin API request");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  });

  if (isPermissionError(response.status)) {
    const body = await response.text().catch(() => "");
    logger.warn(
      { path, statusCode: response.status, body },
      "OpenAI Admin API permission denied"
    );
    return { error: "insufficient_permissions" } as OpenAiPermissionError;
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter ? parseInt(retryAfter, 10) : 60;
    logger.warn(
      { path, retryAfterSeconds: seconds },
      "OpenAI Admin API rate limited"
    );
    throw new OpenAiAdminRateLimitError(seconds);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error(
      { path, statusCode: response.status, body },
      "OpenAI Admin API request failed"
    );
    throw new OpenAiAdminApiError(response.status, body);
  }

  return response.json() as Promise<T>;
};

// ---- Pagination helper ----

const fetchAllPages = async <T extends { has_more: boolean; next_page: string | null; data: unknown[] }>(
  apiKey: string,
  path: string,
  params: Record<string, string | string[]>
): Promise<OpenAiResult<T>> => {
  const allData: unknown[] = [];
  let currentPage: string | undefined;
  let lastResponse: T | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const reqParams = { ...params };
    if (currentPage) {
      reqParams.page = currentPage;
    }

    const result = await makeRequest<T>(apiKey, path, reqParams);

    // If permission error, return immediately
    if ("error" in result) {
      return result;
    }

    allData.push(...result.data);
    lastResponse = result;

    if (!result.has_more || !result.next_page) {
      break;
    }

    currentPage = result.next_page;
  }

  return {
    ...lastResponse!,
    data: allData,
    has_more: false,
    next_page: null,
  } as T;
};

// ---- Public API functions ----

const getCompletionsUsage = async (
  apiKey: string,
  params: OpenAiCompletionsUsageParams
): Promise<OpenAiResult<OpenAiUsageResponse>> => {
  const queryParams: Record<string, string | string[]> = {
    start_time: String(params.startTime),
    end_time: String(params.endTime),
  };

  if (params.bucketWidth) {
    queryParams.bucket_width = params.bucketWidth;
  }
  if (params.groupBy && params.groupBy.length > 0) {
    queryParams["group_by[]"] = params.groupBy;
  }
  if (params.limit !== undefined) {
    queryParams.limit = String(params.limit);
  }

  if (params.page) {
    queryParams.page = params.page;
    return makeRequest<OpenAiUsageResponse>(
      apiKey,
      "/v1/workspace/usage/completions",
      queryParams
    );
  }

  return fetchAllPages<OpenAiUsageResponse>(
    apiKey,
    "/v1/workspace/usage/completions",
    queryParams
  );
};

const getCosts = async (
  apiKey: string,
  params: OpenAiCostParams
): Promise<OpenAiResult<OpenAiCostResponse>> => {
  const queryParams: Record<string, string | string[]> = {
    start_time: String(params.startTime),
    end_time: String(params.endTime),
  };

  if (params.bucketWidth) {
    queryParams.bucket_width = params.bucketWidth;
  }
  if (params.limit !== undefined) {
    queryParams.limit = String(params.limit);
  }

  if (params.page) {
    queryParams.page = params.page;
    return makeRequest<OpenAiCostResponse>(
      apiKey,
      "/v1/workspace/costs",
      queryParams
    );
  }

  return fetchAllPages<OpenAiCostResponse>(
    apiKey,
    "/v1/workspace/costs",
    queryParams
  );
};

// ---- Exported client object ----

export const openaiUsageClient = {
  getCompletionsUsage,
  getCosts,
};
