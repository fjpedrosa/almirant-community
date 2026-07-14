import {
  getConnectionById,
  updateAiProviderKeyCredentials,
} from "@almirant/database";
import { logger } from "@almirant/config";
import {
  anthropicUsageClient,
  AnthropicAdminApiError,
  AnthropicAdminRateLimitError,
  type AnthropicAuthMode,
} from "../../billing/quota/services/anthropic-usage-client";
import { calculateCostUsd } from "../../billing/quota/services/ai-model-pricing";
import { openaiUsageClient } from "../../billing/quota/services/openai-usage-client";
import {
  getOAuthProvider,
  isAnthropicOAuthAuthMethod,
  isAnthropicSetupToken,
} from "./oauth";
import { refreshToken as refreshOAuthToken } from "./oauth/oauth-provider.service";
import { openaiWhamUsageClient, OpenAiWhamApiError } from "../../billing/quota/services/openai-wham-usage-client";
import { geminiUsageClient, GeminiApiError } from "../../billing/quota/services/google-gemini-usage-client";
import { zhipuUsageClient, ZhipuApiError } from "../../billing/quota/services/zhipu-usage-client";
import {
  buildOAuthCredentialsFromTokenResponse,
  resolveEffectiveOAuthTokenExpiresAt,
} from "./oauth/oauth-credential-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionUsageSource =
  | "admin_api"
  | "oauth_usage"
  | "not_available"
  | "admin_key_required"
  | "rate_limited"
  | "error";

type ConnectionUsageResult = {
  supported: boolean;
  source: ConnectionUsageSource;
  period: { startDate: string; endDate: string };
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    requests: number;
  };
  retryAfterSeconds?: number;
  oauthUsage?: {
    fiveHour?: { utilization: number; resetsAt: string };
    sevenDay?: { utilization: number; resetsAt: string };
    sevenDayOpus?: { utilization: number; resetsAt: string };
    sevenDaySonnet?: { utilization: number; resetsAt: string };
    providerStatus?: {
      provider: "openai";
      planType: string | null;
      allowed: boolean | null;
      limitReached: boolean;
      limitReachedType: string | null;
      accountIdentifier: string | null;
      fetchedAt: string;
    };
    extraUsage: {
      isEnabled: boolean;
      monthlyLimit: number;
      usedCredits: number;
      utilization: number;
      currency: string;
    };
  };
  providerUsage?: {
    openai?: {
      billingPeriod: {
        startDate: string;
        endDate: string;
      };
      estimatedCostUsd: number;
      billedCostUsd: number | null;
      currency: string;
      models: Array<{
        model: string;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        totalTokens: number;
        requests: number;
        estimatedCostUsd: number | null;
      }>;
    };
  };
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type CacheEntry<T> = { value: T; expiresAt: number };

const cache = new Map<string, CacheEntry<ConnectionUsageResult>>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const OAUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const getCached = (key: string): ConnectionUsageResult | null => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCache = (key: string, value: ConnectionUsageResult): void => {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
};

const deleteCached = (key: string): void => {
  cache.delete(key);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const zeroTotals = () => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  requests: 0,
});

const unsupportedResult = (
  startDate: string,
  endDate: string,
): ConnectionUsageResult => ({
  supported: false,
  source: "not_available",
  period: { startDate, endDate },
  totals: zeroTotals(),
});

const rateLimitedResult = (
  startDate: string,
  endDate: string,
  retryAfterSeconds: number,
): ConnectionUsageResult => ({
  supported: true,
  source: "rate_limited",
  period: { startDate, endDate },
  totals: zeroTotals(),
  retryAfterSeconds,
});

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const toUnixSeconds = (
  date: string,
  boundary: "start" | "end",
): number => {
  const suffix =
    boundary === "start" ? "T00:00:00.000Z" : "T23:59:59.999Z";
  return Math.floor(new Date(`${date}${suffix}`).getTime() / 1000);
};

const isOpenAiPermissionError = (
  value: unknown,
): value is { error: "insufficient_permissions" } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    value.error === "insufficient_permissions"
  );
};

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const maskAccountIdentifier = (value: string | null | undefined): string | null => {
  const normalized = value?.trim();
  if (!normalized) return null;

  if (normalized.includes("@")) {
    const [name = "", domain = ""] = normalized.split("@");
    if (!domain) return normalized;
    const maskedName =
      name.length <= 2
        ? `${name.slice(0, 1)}…`
        : `${name.slice(0, 2)}…${name.slice(-1)}`;
    return `${maskedName}@${domain}`;
  }

  if (normalized.length <= 10) {
    return normalized;
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
};

// ---------------------------------------------------------------------------
// OAuth refresh
// ---------------------------------------------------------------------------

type LoadedConnection = NonNullable<
  Awaited<ReturnType<typeof getConnectionById>>
>;

const refreshOAuthCredentialsIfNeeded = async (
  connection: LoadedConnection,
  encryptionKey: string,
): Promise<Record<string, unknown> | null> => {
  const credentials = (connection.credentials ?? null) as Record<string, unknown> | null;
  if (!credentials) return null;

  const config = (connection.config ?? {}) as Record<string, unknown>;
  const authMethod =
    (typeof config.authMethod === "string" ? config.authMethod : undefined) ??
    (typeof credentials.authMethod === "string"
      ? (credentials.authMethod as string)
      : undefined);

  if (authMethod !== "oauth") {
    return credentials;
  }

  const expiresAt = resolveEffectiveOAuthTokenExpiresAt({
    tokenExpiresAt: connection.tokenExpiresAt,
    credentials,
  });
  if (!expiresAt || Date.now() + OAUTH_REFRESH_BUFFER_MS < expiresAt.getTime()) {
    return credentials;
  }

  const refreshTokenValue =
    typeof credentials.refreshToken === "string"
      ? (credentials.refreshToken as string)
      : undefined;
  if (!refreshTokenValue) {
    logger.warn(
      { connectionId: connection.id, provider: connection.provider },
      "connection-usage-service: OAuth token expired but no refresh token is available",
    );
    return credentials;
  }

  const providerConfig = await getOAuthProvider(connection.provider);
  if (!providerConfig) {
    logger.warn(
      {
        connectionId: connection.id,
        provider: connection.provider,
      },
      "connection-usage-service: OAuth connection has no refresh configuration",
    );
    return credentials;
  }

  try {
    const tokenData = await refreshOAuthToken(providerConfig, refreshTokenValue);
    const newCredentials = await buildOAuthCredentialsFromTokenResponse({
      provider: connection.provider,
      tokenResponse: tokenData,
      currentCredentials: credentials,
    });

    const newExpiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    await updateAiProviderKeyCredentials(
      connection.id,
      { credentials: newCredentials, tokenExpiresAt: newExpiresAt },
      encryptionKey,
    );

    logger.info(
      {
        connectionId: connection.id,
        provider: connection.provider,
        newExpiresAt: newExpiresAt?.toISOString() ?? null,
      },
      "connection-usage-service: refreshed OAuth token before loading usage",
    );

    return newCredentials;
  } catch (error) {
    logger.warn(
      {
        connectionId: connection.id,
        provider: connection.provider,
        error,
      },
      "connection-usage-service: failed to refresh OAuth token before loading usage",
    );
    return credentials;
  }
};

// ---------------------------------------------------------------------------
// Anthropic implementation
// ---------------------------------------------------------------------------

const fetchAnthropicUsage = async (
  apiKey: string,
  startDate: string,
  endDate: string,
  authMode: AnthropicAuthMode = "api_key",
): Promise<ConnectionUsageResult> => {
  try {
    const [usageReport, costReport] = await Promise.all([
      anthropicUsageClient.getMessageUsageReport(apiKey, {
        startDate,
        endDate,
        bucketWidth: "day",
      }, authMode),
      anthropicUsageClient.getCostReport(apiKey, { startDate, endDate }, authMode),
    ]);

    let inputTokens = 0;
    let outputTokens = 0;

    for (const bucket of usageReport.data) {
      inputTokens += bucket.input_tokens + bucket.input_cached_tokens;
      outputTokens += bucket.output_tokens + bucket.output_cached_tokens;
    }

    let costUsd = 0;
    for (const entry of costReport.data) {
      costUsd += entry.cost_usd;
    }

    const totalTokens = inputTokens + outputTokens;
    const requests = costReport.data.length;

    return {
      supported: true,
      source: "admin_api",
      period: { startDate, endDate },
      totals: { inputTokens, outputTokens, totalTokens, costUsd, requests },
    };
  } catch (error) {
    if (
      error instanceof AnthropicAdminApiError &&
      (error.statusCode === 401 || error.statusCode === 403)
    ) {
      return {
        supported: true,
        source: "admin_key_required",
        period: { startDate, endDate },
        totals: zeroTotals(),
      };
    }
    throw error;
  }
};

const fetchAnthropicOAuthUsage = async (
  token: string,
  startDate: string,
  endDate: string,
): Promise<ConnectionUsageResult> => {
  const oauthData = await anthropicUsageClient.getOAuthUsage(token);

  return {
    supported: true,
    source: "oauth_usage",
    period: { startDate, endDate },
    totals: zeroTotals(),
    oauthUsage: oauthData,
  };
};

// ---------------------------------------------------------------------------
// OpenAI OAuth (WHAM) implementation
// ---------------------------------------------------------------------------

const fetchOpenAiOAuthUsage = async (
  oauthAccessToken: string,
  startDate: string,
  endDate: string,
  accountId?: string,
): Promise<{ result: ConnectionUsageResult; accountId?: string }> => {
  const wham = await openaiWhamUsageClient.getWhamUsage(oauthAccessToken, accountId);
  const whamAccountId = asNonEmptyString(wham.account_id);

  const oauthUsage: ConnectionUsageResult["oauthUsage"] = {
    fiveHour: wham.rate_limit.primary_window
      ? {
          utilization: wham.rate_limit.primary_window.used_percent,
          resetsAt: new Date(
            wham.rate_limit.primary_window.reset_at * 1000,
          ).toISOString(),
        }
      : undefined,
    sevenDay: wham.rate_limit.secondary_window
      ? {
          utilization: wham.rate_limit.secondary_window.used_percent,
          resetsAt: new Date(
            wham.rate_limit.secondary_window.reset_at * 1000,
          ).toISOString(),
        }
      : undefined,
    providerStatus: {
      provider: "openai",
      planType: asNonEmptyString(wham.plan_type) ?? null,
      allowed:
        typeof wham.rate_limit.allowed === "boolean"
          ? wham.rate_limit.allowed
          : null,
      limitReached: wham.rate_limit.limit_reached === true,
      limitReachedType: asNonEmptyString(wham.rate_limit_reached_type) ?? null,
      accountIdentifier: maskAccountIdentifier(
        asNonEmptyString(wham.email) ?? whamAccountId,
      ),
      fetchedAt: new Date().toISOString(),
    },
    extraUsage: {
      isEnabled: wham.credits.has_credits && !wham.credits.unlimited,
      monthlyLimit: 0,
      usedCredits:
        typeof wham.credits.balance === "number"
          ? wham.credits.balance
          : parseFloat(String(wham.credits.balance)) || 0,
      utilization: 0,
      currency: "USD",
    },
  };

  return {
    accountId: whamAccountId,
    result: {
      supported: true,
      source: "oauth_usage",
      period: { startDate, endDate },
      totals: zeroTotals(),
      oauthUsage,
    },
  };
};

// ---------------------------------------------------------------------------
// OpenAI Admin API implementation
// ---------------------------------------------------------------------------

const fetchOpenAiUsage = async (
  apiKey: string,
  startDate: string,
  endDate: string,
): Promise<ConnectionUsageResult> => {
  const [usageReport, costReport] = await Promise.all([
    openaiUsageClient.getCompletionsUsage(apiKey, {
      startTime: toUnixSeconds(startDate, "start"),
      endTime: toUnixSeconds(endDate, "end"),
      bucketWidth: "1d",
      groupBy: ["model"],
    }),
    openaiUsageClient.getCosts(apiKey, {
      startTime: toUnixSeconds(startDate, "start"),
      endTime: toUnixSeconds(endDate, "end"),
      bucketWidth: "1d",
    }),
  ]);

  if (isOpenAiPermissionError(usageReport)) {
    return {
      supported: true,
      source: "admin_key_required",
      period: { startDate, endDate },
      totals: zeroTotals(),
    };
  }

  const models = new Map<
    string,
    {
      model: string;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      requests: number;
      estimatedCostUsd: number | null;
    }
  >();

  let inputTokens = 0;
  let outputTokens = 0;
  let requests = 0;
  let estimatedCostUsd = 0;

  for (const bucket of usageReport.data) {
    for (const result of bucket.results) {
      const model = result.model?.trim() || "Unspecified model";
      // OpenAI reports input_tokens as the inclusive total. Cached input is a
      // subset, not an additional bucket. Clamp defensive provider anomalies
      // before splitting the inclusive total for price calculation.
      const effectiveInputTokens = Number.isFinite(result.input_tokens)
        ? Math.max(0, result.input_tokens)
        : 0;
      const reportedCachedInputTokens = Number.isFinite(result.input_cached_tokens)
        ? Math.max(0, result.input_cached_tokens)
        : 0;
      const cachedInputTokens = Math.min(
        effectiveInputTokens,
        reportedCachedInputTokens,
      );
      const uncachedInputTokens = effectiveInputTokens - cachedInputTokens;
      const effectiveOutputTokens = Number.isFinite(result.output_tokens)
        ? Math.max(0, result.output_tokens)
        : 0;
      const effectiveRequests = Number.isFinite(result.num_model_requests)
        ? Math.max(0, result.num_model_requests)
        : 0;
      const totalTokens = effectiveInputTokens + effectiveOutputTokens;
      const estimatedModelCost = calculateCostUsd({
        provider: "openai",
        model,
        inputTokens: uncachedInputTokens,
        cacheReadInputTokens: cachedInputTokens,
        outputTokens: effectiveOutputTokens,
      });

      const existing =
        models.get(model) ??
        {
          model,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          requests: 0,
          estimatedCostUsd:
            estimatedModelCost === null ? null : 0,
        };

      existing.inputTokens += effectiveInputTokens;
      existing.cachedInputTokens += cachedInputTokens;
      existing.outputTokens += effectiveOutputTokens;
      existing.totalTokens += totalTokens;
      existing.requests += effectiveRequests;

      if (
        existing.estimatedCostUsd !== null &&
        estimatedModelCost !== null
      ) {
        existing.estimatedCostUsd = round6(
          existing.estimatedCostUsd + estimatedModelCost,
        );
      } else {
        existing.estimatedCostUsd = null;
      }

      models.set(model, existing);

      inputTokens += effectiveInputTokens;
      outputTokens += effectiveOutputTokens;
      requests += effectiveRequests;

      if (estimatedModelCost !== null) {
        estimatedCostUsd += estimatedModelCost;
      }
    }
  }

  let billedCostUsd: number | null = null;
  let currency = "USD";

  if (!isOpenAiPermissionError(costReport)) {
    let total = 0;
    let seenCost = false;

    for (const bucket of costReport.data) {
      for (const entry of bucket.results) {
        total += entry.amount.value;
        currency = entry.amount.currency ?? currency;
        seenCost = true;
      }
    }

    billedCostUsd = seenCost ? round6(total) : 0;
  }

  const modelBreakdown = Array.from(models.values()).sort(
    (left, right) => right.totalTokens - left.totalTokens,
  );
  const totalTokens = inputTokens + outputTokens;
  const roundedEstimatedCostUsd = round6(estimatedCostUsd);

  if (
    modelBreakdown.length === 0 &&
    totalTokens === 0 &&
    requests === 0 &&
    (billedCostUsd ?? roundedEstimatedCostUsd) === 0
  ) {
    return {
      supported: true,
      source: "not_available",
      period: { startDate, endDate },
      totals: zeroTotals(),
      providerUsage: {
        openai: {
          billingPeriod: { startDate, endDate },
          estimatedCostUsd: 0,
          billedCostUsd,
          currency,
          models: [],
        },
      },
    };
  }

  return {
    supported: true,
    source: "admin_api",
    period: { startDate, endDate },
    totals: {
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd: billedCostUsd ?? roundedEstimatedCostUsd,
      requests,
    },
    providerUsage: {
      openai: {
        billingPeriod: { startDate, endDate },
        estimatedCostUsd: roundedEstimatedCostUsd,
        billedCostUsd,
        currency,
        models: modelBreakdown,
      },
    },
  };
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const getConnectionUsage = async (
  connectionId: string,
  encryptionKey: string,
  dateRange?: { startDate: string; endDate: string },
  options?: { forceRefresh?: boolean },
): Promise<ConnectionUsageResult> => {
  const now = new Date();
  const startDate =
    dateRange?.startDate ??
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  const endDate =
    dateRange?.endDate ?? now.toISOString().slice(0, 10);

  // Check cache
  const cacheKey = `usage:${connectionId}:${startDate}:${endDate}`;
  if (options?.forceRefresh) {
    deleteCached(cacheKey);
  } else {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  const connection = await getConnectionById(connectionId, encryptionKey);
  if (!connection) {
    return {
      supported: false,
      source: "error",
      period: { startDate, endDate },
      totals: zeroTotals(),
    };
  }

  let result: ConnectionUsageResult;

  switch (connection.provider) {
    case "anthropic": {
      const credentials = (await refreshOAuthCredentialsIfNeeded(
        connection,
        encryptionKey,
      )) as {
        apiKey?: string;
        authMethod?: string;
      } | null;
      const config = connection.config as {
        authMethod?: string;
      } | null;

      const apiKey = credentials?.apiKey;
      if (!apiKey) {
        result = {
          supported: false,
          source: "error" as const,
          period: { startDate, endDate },
          totals: zeroTotals(),
        };
        break;
      }

      const authMethod = config?.authMethod ?? credentials?.authMethod;
      const resolvedAuthMethod =
        authMethod ?? (isAnthropicSetupToken(apiKey) ? "setup_token" : undefined);
      const isOAuth = isAnthropicOAuthAuthMethod(resolvedAuthMethod);

      try {
        result = isOAuth
          ? await fetchAnthropicOAuthUsage(apiKey, startDate, endDate)
          : await fetchAnthropicUsage(apiKey, startDate, endDate);
      } catch (error) {
        if (error instanceof AnthropicAdminRateLimitError) {
          logger.warn(
            {
              connectionId,
              retryAfterSeconds: error.retryAfterSeconds,
            },
            "connection-usage-service: Anthropic usage request rate limited",
          );
          result = rateLimitedResult(
            startDate,
            endDate,
            error.retryAfterSeconds,
          );
          break;
        }

        logger.error(
          { connectionId, error },
          "connection-usage-service: failed to fetch Anthropic usage",
        );
        result = {
          supported: true,
          source: "error",
          period: { startDate, endDate },
          totals: zeroTotals(),
        };
      }
      break;
    }

    case "openai": {
      const credentials = (await refreshOAuthCredentialsIfNeeded(
        connection,
        encryptionKey,
      )) as {
        apiKey?: string;
        oauthAccessToken?: string;
        authMethod?: string;
        openAiAccountId?: string;
      } | null;
      const config = connection.config as { authMethod?: string } | null;
      const authMethod = config?.authMethod ?? credentials?.authMethod;

      // OAuth subscription path: use WHAM endpoint for rate limits
      if (authMethod === "oauth" && credentials?.oauthAccessToken) {
        try {
          const storedAccountId = asNonEmptyString(credentials.openAiAccountId);
          const openAiUsage = await fetchOpenAiOAuthUsage(
            credentials.oauthAccessToken,
            startDate,
            endDate,
            storedAccountId,
          );
          result = openAiUsage.result;

          if (
            openAiUsage.accountId &&
            openAiUsage.accountId !== storedAccountId
          ) {
            try {
              await updateAiProviderKeyCredentials(
                connection.id,
                {
                  credentials: {
                    ...credentials,
                    openAiAccountId: openAiUsage.accountId,
                  },
                },
                encryptionKey,
              );
            } catch (metadataError) {
              logger.warn(
                { connectionId, metadataError },
                "connection-usage-service: failed to persist OpenAI account metadata",
              );
            }
          }
        } catch (error) {
          if (error instanceof OpenAiWhamApiError && (error.statusCode === 401 || error.statusCode === 403)) {
            logger.warn(
              { connectionId, statusCode: error.statusCode },
              "connection-usage-service: WHAM endpoint rejected token — may need re-auth",
            );
          } else {
            logger.error(
              { connectionId, error },
              "connection-usage-service: failed to fetch OpenAI OAuth usage",
            );
          }
          result = {
            supported: true,
            source: "error",
            period: { startDate, endDate },
            totals: zeroTotals(),
          };
        }
        break;
      }

      // Admin API path (org API keys)
      const apiKey = credentials?.apiKey;
      if (!apiKey) {
        result = {
          supported: false,
          source: "error",
          period: { startDate, endDate },
          totals: zeroTotals(),
        };
        break;
      }

      try {
        result = await fetchOpenAiUsage(apiKey, startDate, endDate);
      } catch (error) {
        logger.error(
          { connectionId, error },
          "connection-usage-service: failed to fetch OpenAI usage",
        );
        result = {
          supported: true,
          source: "error",
          period: { startDate, endDate },
          totals: zeroTotals(),
        };
      }
      break;
    }

    case "google": {
      const credentials = (await refreshOAuthCredentialsIfNeeded(
        connection,
        encryptionKey,
      )) as {
        apiKey?: string;
        oauthAccessToken?: string;
        authMethod?: string;
      } | null;
      const config = connection.config as { authMethod?: string } | null;
      const authMethod = config?.authMethod ?? credentials?.authMethod;
      const accessToken = credentials?.oauthAccessToken ?? credentials?.apiKey;

      if (!accessToken || authMethod !== "oauth") {
        result = unsupportedResult(startDate, endDate);
        break;
      }

      try {
        const quota = await geminiUsageClient.getQuota(accessToken);

        // Map Gemini quota buckets to oauthUsage windows.
        // Each bucket represents a model with remainingFraction (0-1).
        // We pick the first two buckets as fiveHour/sevenDay equivalents,
        // or map them all as model-specific windows using sevenDay/sevenDayOpus/sevenDaySonnet.
        const buckets = quota.buckets ?? [];
        const toWindow = (b: typeof buckets[number]) => ({
          utilization: (1 - b.remainingFraction) * 100,
          resetsAt: b.resetTime,
        });

        result = {
          supported: true,
          source: "oauth_usage" as const,
          period: { startDate, endDate },
          totals: zeroTotals(),
          oauthUsage: {
            fiveHour: buckets[0] ? toWindow(buckets[0]) : undefined,
            sevenDay: buckets[1] ? toWindow(buckets[1]) : undefined,
            sevenDayOpus: buckets[2] ? toWindow(buckets[2]) : undefined,
            sevenDaySonnet: buckets[3] ? toWindow(buckets[3]) : undefined,
            extraUsage: {
              isEnabled: false,
              monthlyLimit: 0,
              usedCredits: 0,
              utilization: 0,
              currency: "USD",
            },
          },
        };
      } catch (error) {
        if (error instanceof GeminiApiError && (error.statusCode === 401 || error.statusCode === 403)) {
          logger.warn(
            { connectionId, statusCode: error.statusCode },
            "connection-usage-service: Gemini quota API rejected token",
          );
        } else {
          logger.error(
            { connectionId, error },
            "connection-usage-service: failed to fetch Google Gemini usage",
          );
        }
        result = unsupportedResult(startDate, endDate);
      }
      break;
    }

    case "zai": {
      const credentials = connection.credentials as {
        apiKey?: string;
      } | null;
      const config = connection.config as {
        baseUrl?: string;
      } | null;

      const apiKey = credentials?.apiKey;
      if (!apiKey) {
        result = unsupportedResult(startDate, endDate);
        break;
      }

      // config.baseUrl is the chat/completions path (e.g. ".../api/coding/paas/v4")
      // but the quota endpoint lives at the host root. Extract only the origin.
      let quotaBaseUrl: string | undefined;
      if (config?.baseUrl) {
        try {
          quotaBaseUrl = new URL(config.baseUrl).origin;
        } catch { /* fall back to default */ }
      }

      try {
        const quota = await zhipuUsageClient.getQuota(apiKey, quotaBaseUrl);

        // Map Zhipu quota limits to oauthUsage windows.
        // TOKENS_LIMIT (5h window) → fiveHour
        // TIME_LIMIT (monthly MCP) → sevenDay
        const tokensLimit = quota.limits.find((l) => l.type === "TOKENS_LIMIT");
        const timeLimit = quota.limits.find((l) => l.type === "TIME_LIMIT");

        const toWindow = (entry: typeof tokensLimit) =>
          entry
            ? {
                utilization: entry.usedPercent / 100,
                resetsAt: entry.resetsAt ?? new Date(Date.now() + (entry.windowMinutes ?? 300) * 60_000).toISOString(),
              }
            : undefined;

        result = {
          supported: true,
          source: "oauth_usage" as const,
          period: { startDate, endDate },
          totals: zeroTotals(),
          oauthUsage: {
            fiveHour: toWindow(tokensLimit),
            sevenDay: toWindow(timeLimit),
            extraUsage: {
              isEnabled: false,
              monthlyLimit: 0,
              usedCredits: 0,
              utilization: 0,
              currency: "USD",
            },
          },
        };
      } catch (error) {
        if (error instanceof ZhipuApiError && (error.statusCode === 401 || error.statusCode === 403)) {
          logger.warn(
            { connectionId, statusCode: error.statusCode },
            "connection-usage-service: Zhipu quota API rejected token",
          );
        } else {
          logger.error(
            { connectionId, error },
            "connection-usage-service: failed to fetch Zhipu usage",
          );
        }
        result = unsupportedResult(startDate, endDate);
      }
      break;
    }

    default:
      result = unsupportedResult(startDate, endDate);
      break;
  }

  // Cache successful results
  setCache(cacheKey, result);
  return result;
};

export const connectionUsageService = {
  getConnectionUsage,
};
