/**
 * Zhipu AI (z.ai) Usage Client
 *
 * Fetches quota/usage data from Zhipu's monitoring API.
 * Supports both global (api.z.ai) and China (open.bigmodel.cn) endpoints.
 *
 * Based on CodexBar's ZaiUsageStats implementation.
 */

import { logger } from "@almirant/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZhipuUsageDetail {
  modelCode: string;
  usage: number;
}

interface ZhipuLimitRaw {
  type: string;
  unit: number;
  number: number;
  usage: number | null;
  currentValue: number | null;
  remaining: number | null;
  percentage: number;
  usageDetails?: ZhipuUsageDetail[];
  nextResetTime?: number | null;
}

interface ZhipuQuotaApiResponse {
  code: number;
  msg: string;
  success: boolean;
  data?: {
    limits: ZhipuLimitRaw[];
    planName?: string;
  };
}

export interface ZhipuLimitEntry {
  type: "TOKENS_LIMIT" | "TIME_LIMIT";
  windowMinutes: number | null;
  usedPercent: number;
  totalQuota: number | null;
  used: number | null;
  remaining: number | null;
  resetsAt: string | null;
  modelBreakdown: ZhipuUsageDetail[];
}

export interface ZhipuQuotaResult {
  planName: string | null;
  limits: ZhipuLimitEntry[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ZhipuApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(`Zhipu API error ${statusCode}: ${message}`);
    this.name = "ZhipuApiError";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUOTA_PATH = "/api/monitor/usage/quota/limit";
const DEFAULT_BASE_URL = "https://api.z.ai";

/** Convert Zhipu unit enum to minutes */
const unitToMinutes = (unit: number, count: number): number | null => {
  switch (unit) {
    case 5: return count;           // minutes
    case 3: return count * 60;      // hours
    case 1: return count * 24 * 60; // days
    default: return null;
  }
};

/**
 * Compute used percent from quota fields, matching CodexBar's logic:
 * 1. Prefer (usage - remaining), take max with currentValue
 * 2. Fall back to API-provided percentage
 */
const computeUsedPercent = (limit: ZhipuLimitRaw): number => {
  const total = limit.usage;
  if (total == null || total <= 0) return limit.percentage;

  let usedRaw: number | null = null;

  if (limit.remaining != null) {
    const usedFromRemaining = total - limit.remaining;
    if (limit.currentValue != null) {
      usedRaw = Math.max(usedFromRemaining, limit.currentValue);
    } else {
      usedRaw = usedFromRemaining;
    }
  } else if (limit.currentValue != null) {
    usedRaw = limit.currentValue;
  }

  if (usedRaw == null) return limit.percentage;

  const used = Math.max(0, Math.min(total, usedRaw));
  return Math.min(100, Math.max(0, (used / total) * 100));
};

const parseLimitEntry = (raw: ZhipuLimitRaw): ZhipuLimitEntry => {
  const type = raw.type === "TOKENS_LIMIT" ? "TOKENS_LIMIT" : "TIME_LIMIT";
  const windowMinutes = unitToMinutes(raw.unit, raw.number);
  const usedPercent = computeUsedPercent(raw);

  let resetsAt: string | null = null;
  if (raw.nextResetTime != null && raw.nextResetTime > 0) {
    resetsAt = new Date(raw.nextResetTime).toISOString();
  }

  return {
    type,
    windowMinutes,
    usedPercent,
    totalQuota: raw.usage,
    used: raw.currentValue,
    remaining: raw.remaining,
    resetsAt,
    modelBreakdown: raw.usageDetails ?? [],
  };
};

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const getQuota = async (
  apiKey: string,
  baseUrl?: string,
): Promise<ZhipuQuotaResult> => {
  const url = `${baseUrl ?? DEFAULT_BASE_URL}${QUOTA_PATH}`;
  logger.debug({ url }, "Zhipu quota request");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    logger.error(
      { statusCode: response.status, body },
      "Zhipu quota request failed",
    );
    throw new ZhipuApiError(response.status, body);
  }

  const json = (await response.json()) as ZhipuQuotaApiResponse;

  if (!json.success || json.code !== 200 || !json.data) {
    logger.error(
      { code: json.code, msg: json.msg },
      "Zhipu quota API returned error",
    );
    throw new ZhipuApiError(json.code, json.msg);
  }

  return {
    planName: json.data.planName ?? null,
    limits: json.data.limits.map(parseLimitEntry),
  };
};

export const zhipuUsageClient = { getQuota };
