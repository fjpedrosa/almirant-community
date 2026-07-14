import { afterEach, beforeEach, describe, expect, it, spyOn, mock } from "bun:test";
import * as database from "@almirant/database";
import * as anthropicClient from "../../billing/quota/services/anthropic-usage-client";
import * as openaiClient from "../../billing/quota/services/openai-usage-client";
import * as openaiWhamClient from "../../billing/quota/services/openai-wham-usage-client";
import * as oauthService from "./oauth/oauth-provider.service";
import * as openaiTokenExchange from "./oauth/openai-token-exchange";

// ---------------------------------------------------------------------------
// Spies — set up once at module scope, controlled via mock return values per test.
// ---------------------------------------------------------------------------

const getConnectionByIdSpy = spyOn(database, "getConnectionById");
const updateCredentialsSpy = spyOn(database, "updateAiProviderKeyCredentials");

const getOAuthUsageSpy = spyOn(anthropicClient.anthropicUsageClient, "getOAuthUsage");

const getOpenAiCompletionsUsageSpy = spyOn(openaiClient.openaiUsageClient, "getCompletionsUsage");
const getOpenAiCostsSpy = spyOn(openaiClient.openaiUsageClient, "getCosts");
const getOpenAiWhamUsageSpy = spyOn(openaiWhamClient.openaiWhamUsageClient, "getWhamUsage");

const refreshOAuthTokenSpy = spyOn(oauthService, "refreshToken");
const exchangeIdTokenForApiKeySpy = spyOn(
  openaiTokenExchange,
  "exchangeIdTokenForApiKey",
);

describe("connectionUsageService", () => {
  beforeEach(() => {
    getConnectionByIdSpy.mockReset();
    updateCredentialsSpy.mockReset();
    getOAuthUsageSpy.mockReset();
    getOpenAiCompletionsUsageSpy.mockReset();
    getOpenAiCostsSpy.mockReset();
    getOpenAiWhamUsageSpy.mockReset();
    refreshOAuthTokenSpy.mockReset();
    exchangeIdTokenForApiKeySpy.mockReset();
    exchangeIdTokenForApiKeySpy.mockResolvedValue("exchanged-openai-api-key");

    // Default: updateCredentials resolves
    updateCredentialsSpy.mockResolvedValue(null as never);
  });

  afterEach(() => {
    // No mock.restore() needed — spies persist across tests.
  });

  it("refreshes expired Anthropic OAuth credentials before loading usage", async () => {
    getConnectionByIdSpy.mockResolvedValue({
      id: "conn-1",
      provider: "anthropic",
      category: "ai",
      scope: "user",
      scopeId: "user-1",
      tokenExpiresAt: "2026-03-08T00:00:00.000Z",
      config: { authMethod: "oauth" },
      credentials: {
        apiKey: "expired-access-token",
        authMethod: "oauth",
        refreshToken: "refresh-token",
      },
    } as never);
    refreshOAuthTokenSpy.mockResolvedValue({
      access_token: "fresh-access-token",
      refresh_token: "fresh-refresh-token",
      expires_in: 3600,
    } as never);
    getOAuthUsageSpy.mockResolvedValue({
      fiveHour: { utilization: 42, resetsAt: "2026-03-09T10:00:00.000Z" },
      extraUsage: {
        isEnabled: false,
        monthlyLimit: 0,
        usedCredits: 0,
        utilization: 0,
        currency: "USD",
      },
    } as never);

    const { connectionUsageService } = await import("./connection-usage-service");
    const result = await connectionUsageService.getConnectionUsage(
      "conn-1",
      "encryption-key",
      { startDate: "2026-02-07", endDate: "2026-03-09" },
      { forceRefresh: true },
    );

    expect(refreshOAuthTokenSpy).toHaveBeenCalledTimes(1);
    expect(updateCredentialsSpy).toHaveBeenCalledTimes(1);
    expect(getOAuthUsageSpy).toHaveBeenCalledWith("fresh-access-token");
    expect(result).toEqual({
      supported: true,
      source: "oauth_usage",
      period: { startDate: "2026-02-07", endDate: "2026-03-09" },
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        requests: 0,
      },
      oauthUsage: {
        fiveHour: { utilization: 42, resetsAt: "2026-03-09T10:00:00.000Z" },
        extraUsage: {
          isEnabled: false,
          monthlyLimit: 0,
          usedCredits: 0,
          utilization: 0,
          currency: "USD",
        },
      },
    });
  });

  it("returns OpenAI admin usage with model breakdown and cost summaries", async () => {
    getConnectionByIdSpy.mockResolvedValue({
      id: "conn-openai-1",
      provider: "openai",
      category: "ai",
      scope: "user",
      scopeId: "user-1",
      tokenExpiresAt: null,
      config: { authMethod: "api_key" },
      credentials: {
        apiKey: "sk-openai-admin",
        authMethod: "api_key",
      },
    } as never);
    getOpenAiCompletionsUsageSpy.mockResolvedValue({
      object: "list",
      has_more: false,
      next_page: null,
      data: [
        {
          start_time: 1_741_484_800,
          end_time: 1_741_571_199,
          results: [
            {
              object: "workspace.usage.completions.result",
              model: "gpt-4o",
              input_tokens: 2_000_000,
              input_cached_tokens: 100_000,
              output_tokens: 500_000,
              num_model_requests: 400,
            },
            {
              object: "workspace.usage.completions.result",
              model: "o3-mini",
              input_tokens: 1_000_000,
              input_cached_tokens: 0,
              output_tokens: 250_000,
              num_model_requests: 120,
            },
          ],
        },
      ],
    } as never);
    getOpenAiCostsSpy.mockResolvedValue({
      object: "list",
      has_more: false,
      next_page: null,
      data: [
        {
          start_time: 1_741_484_800,
          end_time: 1_741_571_199,
          results: [
            {
              object: "workspace.costs.result",
              amount: { value: 14.32, currency: "USD" },
              line_item: "completions",
            },
          ],
        },
      ],
    } as never);

    const { connectionUsageService } = await import("./connection-usage-service");
    const result = await connectionUsageService.getConnectionUsage(
      "conn-openai-1",
      "encryption-key",
      { startDate: "2025-03-09", endDate: "2025-03-10" },
      { forceRefresh: true },
    );

    expect(getOpenAiCompletionsUsageSpy).toHaveBeenCalledWith(
      "sk-openai-admin",
      expect.objectContaining({
        bucketWidth: "1d",
        groupBy: ["model"],
      }),
    );
    expect(getOpenAiCostsSpy).toHaveBeenCalledWith(
      "sk-openai-admin",
      expect.objectContaining({
        bucketWidth: "1d",
      }),
    );
    expect(result).toEqual({
      supported: true,
      source: "admin_api",
      period: { startDate: "2025-03-09", endDate: "2025-03-10" },
      totals: {
        inputTokens: 3_000_000,
        outputTokens: 750_000,
        totalTokens: 3_750_000,
        costUsd: 14.32,
        requests: 520,
      },
      providerUsage: {
        openai: {
          billingPeriod: {
            startDate: "2025-03-09",
            endDate: "2025-03-10",
          },
          estimatedCostUsd: 12.075,
          billedCostUsd: 14.32,
          currency: "USD",
          models: [
            {
              model: "gpt-4o",
              inputTokens: 2_000_000,
              cachedInputTokens: 100_000,
              outputTokens: 500_000,
              totalTokens: 2_500_000,
              requests: 400,
              estimatedCostUsd: 9.875,
            },
            {
              model: "o3-mini",
              inputTokens: 1_000_000,
              cachedInputTokens: 0,
              outputTokens: 250_000,
              totalTokens: 1_250_000,
              requests: 120,
              estimatedCostUsd: 2.2,
            },
          ],
        },
      },
    });
  });

  it("prices GPT-5.6 cached tokens as an inclusive subset and clamps malformed provider totals", async () => {
    getConnectionByIdSpy.mockResolvedValue({
      id: "conn-openai-inclusive-cache",
      provider: "openai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      tokenExpiresAt: null,
      config: { authMethod: "api_key" },
      credentials: { apiKey: "sk-openai-admin", authMethod: "api_key" },
    } as never);
    getOpenAiCompletionsUsageSpy.mockResolvedValue({
      object: "list",
      has_more: false,
      next_page: null,
      data: [{
        start_time: 1,
        end_time: 2,
        results: [
          {
            object: "workspace.usage.completions.result",
            model: "gpt-5.6-sol",
            input_tokens: 1_000_000,
            input_cached_tokens: 200_000,
            output_tokens: 100_000,
            num_model_requests: 1,
          },
          {
            object: "workspace.usage.completions.result",
            model: "gpt-5.6-terra",
            input_tokens: 500_000,
            input_cached_tokens: 100_000,
            output_tokens: 50_000,
            num_model_requests: 1,
          },
          {
            object: "workspace.usage.completions.result",
            model: "gpt-5.6-luna",
            input_tokens: 100_000,
            input_cached_tokens: 200_000,
            output_tokens: 0,
            num_model_requests: 1,
          },
        ],
      }],
    } as never);
    getOpenAiCostsSpy.mockResolvedValue({ error: "insufficient_permissions" } as never);

    const { connectionUsageService } = await import("./connection-usage-service");
    const result = await connectionUsageService.getConnectionUsage(
      "conn-openai-inclusive-cache",
      "encryption-key",
      { startDate: "2026-07-01", endDate: "2026-07-02" },
      { forceRefresh: true },
    );

    expect(result.totals).toMatchObject({
      inputTokens: 1_600_000,
      outputTokens: 150_000,
      totalTokens: 1_750_000,
      costUsd: 8.885,
    });
    expect(result.providerUsage?.openai?.estimatedCostUsd).toBe(8.885);
    expect(result.providerUsage?.openai?.models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        model: "gpt-5.6-sol",
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        totalTokens: 1_100_000,
        estimatedCostUsd: 7.1,
      }),
      expect.objectContaining({
        model: "gpt-5.6-terra",
        inputTokens: 500_000,
        cachedInputTokens: 100_000,
        totalTokens: 550_000,
        estimatedCostUsd: 1.775,
      }),
      expect.objectContaining({
        model: "gpt-5.6-luna",
        inputTokens: 100_000,
        cachedInputTokens: 100_000,
        totalTokens: 100_000,
        estimatedCostUsd: 0.01,
      }),
    ]));
  });

  it("returns admin_key_required when OpenAI usage lacks workspace permissions", async () => {
    getConnectionByIdSpy.mockResolvedValue({
      id: "conn-openai-2",
      provider: "openai",
      category: "ai",
      scope: "user",
      scopeId: "user-1",
      tokenExpiresAt: null,
      config: { authMethod: "api_key" },
      credentials: {
        apiKey: "sk-openai-non-admin",
        authMethod: "api_key",
      },
    } as never);
    getOpenAiCompletionsUsageSpy.mockResolvedValue({
      error: "insufficient_permissions",
    } as never);
    getOpenAiCostsSpy.mockResolvedValue({
      error: "insufficient_permissions",
    } as never);

    const { connectionUsageService } = await import("./connection-usage-service");
    const result = await connectionUsageService.getConnectionUsage(
      "conn-openai-2",
      "encryption-key",
      { startDate: "2025-03-09", endDate: "2025-03-10" },
      { forceRefresh: true },
    );

    expect(result).toEqual({
      supported: true,
      source: "admin_key_required",
      period: { startDate: "2025-03-09", endDate: "2025-03-10" },
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        requests: 0,
      },
    });
  });

  it("returns rate_limited when Anthropic OAuth usage is throttled", async () => {
    getConnectionByIdSpy.mockResolvedValue({
      id: "conn-anthropic-rate-limit",
      provider: "anthropic",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      tokenExpiresAt: null,
      config: { authMethod: "oauth" },
      credentials: {
        apiKey: "oauth-access-token",
        authMethod: "oauth",
      },
    } as never);
    getOAuthUsageSpy.mockRejectedValue(
      new anthropicClient.AnthropicAdminRateLimitError(0),
    );

    const { connectionUsageService } = await import("./connection-usage-service");
    const result = await connectionUsageService.getConnectionUsage(
      "conn-anthropic-rate-limit",
      "encryption-key",
      { startDate: "2026-02-07", endDate: "2026-03-09" },
      { forceRefresh: true },
    );

    expect(result).toEqual({
      supported: true,
      source: "rate_limited",
      period: { startDate: "2026-02-07", endDate: "2026-03-09" },
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        requests: 0,
      },
      retryAfterSeconds: 0,
    });
  });

  it("refreshes OpenAI OAuth usage when oauthAccessToken JWT is already expired despite a later tokenExpiresAt", async () => {
    const exp = Math.floor(Date.parse("2026-04-12T17:51:31.000Z") / 1000);
    const expiredOauthToken = `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;

    getConnectionByIdSpy.mockResolvedValue({
      id: "conn-openai-oauth-expired",
      provider: "openai",
      category: "ai",
      scope: "user",
      scopeId: "user-1",
      tokenExpiresAt: "2026-04-22T17:47:39.000Z",
      config: { authMethod: "oauth" },
      credentials: {
        apiKey: "newer-api-key-jwt",
        oauthAccessToken: expiredOauthToken,
        authMethod: "oauth",
        refreshToken: "refresh-openai",
        idToken: "existing-id-token",
      },
    } as never);
    refreshOAuthTokenSpy.mockResolvedValue({
      access_token: "fresh-oauth-access-token",
      refresh_token: "fresh-refresh-token",
      expires_in: 3600,
      id_token: "fresh-id-token",
    } as never);
    getOpenAiWhamUsageSpy.mockResolvedValue({
      rate_limit: {
        primary_window: {
          used_percent: 12,
          reset_at: 1_775_000_000,
        },
        secondary_window: {
          used_percent: 34,
          reset_at: 1_775_100_000,
        },
      },
      credits: {
        has_credits: false,
        unlimited: true,
        balance: 0,
      },
    } as never);

    const { connectionUsageService } = await import("./connection-usage-service");
    const result = await connectionUsageService.getConnectionUsage(
      "conn-openai-oauth-expired",
      "encryption-key",
      { startDate: "2026-04-01", endDate: "2026-04-13" },
      { forceRefresh: true },
    );

    expect(refreshOAuthTokenSpy).toHaveBeenCalledTimes(1);
    expect(updateCredentialsSpy).toHaveBeenCalledTimes(1);
    expect(updateCredentialsSpy).toHaveBeenCalledWith(
      "conn-openai-oauth-expired",
      expect.objectContaining({
        credentials: expect.objectContaining({
          apiKey: "exchanged-openai-api-key",
          oauthAccessToken: "fresh-oauth-access-token",
          refreshToken: "fresh-refresh-token",
          authMethod: "oauth",
        }),
      }),
      "encryption-key",
    );
    expect(getOpenAiWhamUsageSpy).toHaveBeenCalledWith(
      "fresh-oauth-access-token",
      undefined,
    );
    expect(result.source).toBe("oauth_usage");
  });

  it("passes stored OpenAI account id to WHAM and exposes non-sensitive subscription status", async () => {
    getConnectionByIdSpy.mockResolvedValue({
      id: "conn-openai-oauth-account",
      provider: "openai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      tokenExpiresAt: "2026-05-06T13:05:35.000Z",
      config: { authMethod: "oauth" },
      credentials: {
        apiKey: "openai-api-key",
        oauthAccessToken: "oauth-access-token",
        authMethod: "oauth",
        refreshToken: "refresh-openai",
        openAiAccountId: "account-existing",
      },
    } as never);
    getOpenAiWhamUsageSpy.mockResolvedValue({
      account_id: "account-existing",
      email: "person@example.com",
      plan_type: "pro",
      rate_limit_reached_type: null,
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 2,
          reset_at: 1_777_813_213,
          limit_window_seconds: 18_000,
        },
        secondary_window: {
          used_percent: 86,
          reset_at: 1_777_959_001,
          limit_window_seconds: 604_800,
        },
      },
      credits: {
        has_credits: true,
        unlimited: false,
        balance: "2105.989325",
      },
    } as never);

    const { connectionUsageService } = await import("./connection-usage-service");
    const result = await connectionUsageService.getConnectionUsage(
      "conn-openai-oauth-account",
      "encryption-key",
      { startDate: "2026-05-03", endDate: "2026-05-03" },
      { forceRefresh: true },
    );

    expect(getOpenAiWhamUsageSpy).toHaveBeenCalledWith(
      "oauth-access-token",
      "account-existing",
    );
    expect(updateCredentialsSpy).not.toHaveBeenCalled();
    expect(result.source).toBe("oauth_usage");
    expect(result.oauthUsage?.fiveHour?.utilization).toBe(2);
    expect(result.oauthUsage?.sevenDay?.utilization).toBe(86);
    expect(result.oauthUsage?.providerStatus).toMatchObject({
      provider: "openai",
      planType: "pro",
      allowed: true,
      limitReached: false,
      limitReachedType: null,
      accountIdentifier: "pe…n@example.com",
    });
  });
});
