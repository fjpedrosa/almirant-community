/**
 * Google Gemini Usage Client
 *
 * Fetches quota/usage data for Gemini CLI subscriptions via Google's internal
 * Cloud Code Assist API. This is the same approach used by codexbar.
 *
 * Requires a Google OAuth access_token (from Gemini CLI credentials).
 */

import { logger } from "@almirant/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeminiQuotaBucket {
  modelId: string;
  remainingFraction: number;
  resetTime: string;
  tokenType?: string;
}

export interface GeminiQuotaResponse {
  buckets: GeminiQuotaBucket[];
}

export interface GeminiCodeAssistResponse {
  currentTier?: {
    id: string;
    name: string;
  };
  cloudaicompanionProject?:
    | string
    | { id?: string; projectId?: string };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GeminiApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(`Gemini API error ${statusCode}: ${message}`);
    this.name = "GeminiApiError";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const QUOTA_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const CODE_ASSIST_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

const getQuota = async (
  accessToken: string,
  projectId?: string,
): Promise<GeminiQuotaResponse> => {
  logger.debug({ url: QUOTA_URL, projectId }, "Gemini quota request");

  const response = await fetch(QUOTA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(projectId ? { project: projectId } : {}),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error(
      { statusCode: response.status, body },
      "Gemini quota request failed",
    );
    throw new GeminiApiError(response.status, body);
  }

  return response.json() as Promise<GeminiQuotaResponse>;
};

const getCodeAssistStatus = async (
  accessToken: string,
): Promise<GeminiCodeAssistResponse> => {
  logger.debug({ url: CODE_ASSIST_URL }, "Gemini code assist status request");

  const response = await fetch(CODE_ASSIST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error(
      { statusCode: response.status, body },
      "Gemini code assist status request failed",
    );
    throw new GeminiApiError(response.status, body);
  }

  return response.json() as Promise<GeminiCodeAssistResponse>;
};

export const geminiUsageClient = { getQuota, getCodeAssistStatus };
