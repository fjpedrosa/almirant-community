/**
 * OpenAI WHAM Usage Client
 *
 * Fetches rate-limit usage for ChatGPT subscription accounts (Pro, Plus, etc.)
 * via the internal WHAM endpoint. This is the same approach used by codexbar.
 *
 * Requires the raw OAuth access_token (NOT the exchanged API key).
 */

import { logger } from "@almirant/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenAiWhamRateWindow {
  used_percent: number;
  reset_at: number;
  limit_window_seconds: number;
  reset_after_seconds?: number;
}

export interface OpenAiWhamUsageResponse {
  account_id?: string;
  email?: string;
  plan_type: string;
  rate_limit: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window: OpenAiWhamRateWindow | null;
    secondary_window: OpenAiWhamRateWindow | null;
  };
  rate_limit_reached_type?: string | null;
  credits: {
    has_credits: boolean;
    unlimited: boolean;
    balance: number | string;
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OpenAiWhamApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(`OpenAI WHAM API error ${statusCode}: ${message}`);
    this.name = "OpenAiWhamApiError";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const getWhamUsage = async (
  accessToken: string,
  accountId?: string,
): Promise<OpenAiWhamUsageResponse> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  logger.debug({ url: WHAM_USAGE_URL }, "OpenAI WHAM usage request");

  const response = await fetch(WHAM_USAGE_URL, { headers });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error(
      { statusCode: response.status, body },
      "OpenAI WHAM usage request failed",
    );
    throw new OpenAiWhamApiError(response.status, body);
  }

  return response.json() as Promise<OpenAiWhamUsageResponse>;
};

export const openaiWhamUsageClient = { getWhamUsage };
