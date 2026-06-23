import { env, logger } from "@almirant/config";
import { ANTHROPIC_STEALTH_HEADERS } from "../../../connections/services/oauth";

// ---- Auth mode type ----

export type AnthropicAuthMode = "api_key" | "bearer";

// ---- Constants ----

const ANTHROPIC_ADMIN_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION = "2023-06-01";

// ---- Error types ----

export class AnthropicAdminApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`Anthropic Admin API error ${statusCode}: ${responseBody}`);
    this.name = "AnthropicAdminApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class AnthropicAdminRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Anthropic Admin API rate limited. Retry after ${retryAfterSeconds}s`);
    this.name = "AnthropicAdminRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---- Request parameter types ----

export interface AnthropicUsageReportParams {
  startDate: string;
  endDate: string;
  bucketWidth?: "hour" | "day" | "week" | "month";
  groupBy?: string[];
}

export interface AnthropicCostReportParams {
  startDate: string;
  endDate: string;
  cursor?: string;
  limit?: number;
}

export interface AnthropicClaudeCodeParams {
  startDate: string;
  endDate: string;
  bucketWidth?: "hour" | "day" | "week" | "month";
}

// ---- Response types ----

export interface AnthropicUsageBucket {
  date: string;
  input_tokens: number;
  output_tokens: number;
  input_cached_tokens: number;
  output_cached_tokens: number;
  model: string;
  workspace_id?: string;
  api_key_id?: string;
  api_key_name?: string;
}

export interface AnthropicUsageReportResponse {
  data: AnthropicUsageBucket[];
}

export interface AnthropicCostEntry {
  date: string;
  workspace_id: string;
  workspace_name: string;
  api_key_id: string;
  api_key_name: string;
  model: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  input_cached_tokens: number;
  output_cached_tokens: number;
}

export interface AnthropicCostReportResponse {
  data: AnthropicCostEntry[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface AnthropicClaudeCodeBucket {
  date: string;
  total_turns: number;
  total_sessions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  model: string;
  user_email?: string;
}

export interface AnthropicClaudeCodeResponse {
  data: AnthropicClaudeCodeBucket[];
}

// ---- OAuth usage response types ----

export interface AnthropicOAuthUsageWindow {
  utilization: number;
  resetsAt: string;
}

export interface AnthropicOAuthExtraUsage {
  isEnabled: boolean;
  monthlyLimit: number;
  usedCredits: number;
  utilization: number;
  currency: string;
}

export interface AnthropicOAuthUsageResponse {
  fiveHour?: AnthropicOAuthUsageWindow;
  sevenDay?: AnthropicOAuthUsageWindow;
  sevenDayOpus?: AnthropicOAuthUsageWindow;
  sevenDaySonnet?: AnthropicOAuthUsageWindow;
  extraUsage: AnthropicOAuthExtraUsage;
}

interface AnthropicOAuthUsageWindowRaw {
  utilization?: number | null;
  resets_at?: string | null;
  resetsAt?: string | null;
}

interface AnthropicOAuthExtraUsageRaw {
  is_enabled?: boolean | null;
  isEnabled?: boolean | null;
  monthly_limit?: number | null;
  monthlyLimit?: number | null;
  used_credits?: number | null;
  usedCredits?: number | null;
  utilization?: number | null;
  currency?: string | null;
}

interface AnthropicOAuthUsageResponseRaw {
  five_hour?: AnthropicOAuthUsageWindowRaw | null;
  fiveHour?: AnthropicOAuthUsageWindowRaw | null;
  seven_day?: AnthropicOAuthUsageWindowRaw | null;
  sevenDay?: AnthropicOAuthUsageWindowRaw | null;
  seven_day_opus?: AnthropicOAuthUsageWindowRaw | null;
  sevenDayOpus?: AnthropicOAuthUsageWindowRaw | null;
  seven_day_sonnet?: AnthropicOAuthUsageWindowRaw | null;
  sevenDaySonnet?: AnthropicOAuthUsageWindowRaw | null;
  extra_usage?: AnthropicOAuthExtraUsageRaw | null;
  extraUsage?: AnthropicOAuthExtraUsageRaw | null;
}

// ---- Internal helpers ----

const getAdminApiKey = (): string | null => {
  return env.ANTHROPIC_ADMIN_API_KEY ?? null;
};

const normalizeUtilizationPercent = (value: number | null | undefined): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  // Claude's OAuth usage can arrive either as 0-1 fractions or 0-100 percentages.
  return value <= 1 ? value * 100 : value;
};

const normalizeOAuthWindow = (
  raw: AnthropicOAuthUsageWindowRaw | null | undefined,
): AnthropicOAuthUsageWindow | undefined => {
  const resetsAt = raw?.resets_at ?? raw?.resetsAt;
  if (!resetsAt) {
    return undefined;
  }

  return {
    utilization: normalizeUtilizationPercent(raw?.utilization),
    resetsAt,
  };
};

export const normalizeAnthropicOAuthUsageResponse = (
  raw: AnthropicOAuthUsageResponseRaw,
): AnthropicOAuthUsageResponse => {
  const extraUsageRaw = raw.extra_usage ?? raw.extraUsage;

  return {
    fiveHour: normalizeOAuthWindow(raw.five_hour ?? raw.fiveHour),
    sevenDay: normalizeOAuthWindow(raw.seven_day ?? raw.sevenDay),
    sevenDayOpus: normalizeOAuthWindow(raw.seven_day_opus ?? raw.sevenDayOpus),
    sevenDaySonnet: normalizeOAuthWindow(
      raw.seven_day_sonnet ?? raw.sevenDaySonnet,
    ),
    extraUsage: {
      isEnabled: Boolean(extraUsageRaw?.is_enabled ?? extraUsageRaw?.isEnabled),
      monthlyLimit:
        extraUsageRaw?.monthly_limit ?? extraUsageRaw?.monthlyLimit ?? 0,
      usedCredits:
        extraUsageRaw?.used_credits ?? extraUsageRaw?.usedCredits ?? 0,
      utilization: normalizeUtilizationPercent(extraUsageRaw?.utilization),
      currency: extraUsageRaw?.currency ?? "USD",
    },
  };
};

const makeRequest = async <T>(
  path: string,
  params?: Record<string, string>,
  explicitApiKey?: string,
  authMode: AnthropicAuthMode = "api_key"
): Promise<T> => {
  const apiKey = explicitApiKey ?? getAdminApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_ADMIN_API_KEY not configured");
  }

  const url = new URL(path, ANTHROPIC_ADMIN_API_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  logger.debug({ path, params, authMode }, "Anthropic Admin API request");

  const headers: Record<string, string> = {
    "anthropic-version": ANTHROPIC_API_VERSION,
    "content-type": "application/json",
  };

  if (authMode === "bearer") {
    headers["Authorization"] = `Bearer ${apiKey}`;
    Object.assign(headers, ANTHROPIC_STEALTH_HEADERS);
  } else {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch(url.toString(), { headers });

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter ? parseInt(retryAfter, 10) : 60;
    logger.warn(
      { path, retryAfterSeconds: seconds },
      "Anthropic Admin API rate limited"
    );
    throw new AnthropicAdminRateLimitError(seconds);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error(
      { path, statusCode: response.status, body },
      "Anthropic Admin API request failed"
    );
    throw new AnthropicAdminApiError(response.status, body);
  }

  return response.json() as Promise<T>;
};

// ---- Public API functions ----

const isConfigured = (): boolean => {
  return Boolean(env.ANTHROPIC_ADMIN_API_KEY);
};

const getMessageUsageReport = async (
  paramsOrApiKey: AnthropicUsageReportParams | string,
  maybeParams?: AnthropicUsageReportParams,
  authMode?: AnthropicAuthMode
): Promise<AnthropicUsageReportResponse> => {
  const apiKey = typeof paramsOrApiKey === "string" ? paramsOrApiKey : undefined;
  const params = typeof paramsOrApiKey === "string" ? maybeParams! : paramsOrApiKey;

  const queryParams: Record<string, string> = {
    start_date: params.startDate,
    end_date: params.endDate,
  };

  if (params.bucketWidth) {
    queryParams.bucket_width = params.bucketWidth;
  }
  if (params.groupBy && params.groupBy.length > 0) {
    queryParams.group_by = params.groupBy.join(",");
  }

  return makeRequest<AnthropicUsageReportResponse>(
    "/v1/organizations/usage_report/messages",
    queryParams,
    apiKey,
    authMode
  );
};

const getCostReport = async (
  paramsOrApiKey: AnthropicCostReportParams | string,
  maybeParams?: AnthropicCostReportParams,
  authMode?: AnthropicAuthMode
): Promise<AnthropicCostReportResponse> => {
  const apiKey = typeof paramsOrApiKey === "string" ? paramsOrApiKey : undefined;
  const params = typeof paramsOrApiKey === "string" ? maybeParams! : paramsOrApiKey;

  const queryParams: Record<string, string> = {
    start_date: params.startDate,
    end_date: params.endDate,
  };

  if (params.cursor) {
    queryParams.cursor = params.cursor;
  }
  if (params.limit !== undefined) {
    queryParams.limit = String(params.limit);
  }

  return makeRequest<AnthropicCostReportResponse>(
    "/v1/organizations/cost_report",
    queryParams,
    apiKey,
    authMode
  );
};

const getClaudeCodeAnalytics = async (
  paramsOrApiKey: AnthropicClaudeCodeParams | string,
  maybeParams?: AnthropicClaudeCodeParams,
  authMode?: AnthropicAuthMode
): Promise<AnthropicClaudeCodeResponse> => {
  const apiKey = typeof paramsOrApiKey === "string" ? paramsOrApiKey : undefined;
  const params = typeof paramsOrApiKey === "string" ? maybeParams! : paramsOrApiKey;

  const queryParams: Record<string, string> = {
    start_date: params.startDate,
    end_date: params.endDate,
  };

  if (params.bucketWidth) {
    queryParams.bucket_width = params.bucketWidth;
  }

  return makeRequest<AnthropicClaudeCodeResponse>(
    "/v1/organizations/usage_report/claude_code",
    queryParams,
    apiKey,
    authMode
  );
};

const getOAuthUsage = async (
  token: string
): Promise<AnthropicOAuthUsageResponse> => {
  const rawResponse = await makeRequest<AnthropicOAuthUsageResponseRaw>(
    "/api/oauth/usage",
    undefined,
    token,
    "bearer"
  );

  return normalizeAnthropicOAuthUsageResponse(rawResponse);
};

// ---- Exported client object ----

export const anthropicUsageClient = {
  isConfigured,
  getMessageUsageReport,
  getCostReport,
  getClaudeCodeAnalytics,
  getOAuthUsage,
};
