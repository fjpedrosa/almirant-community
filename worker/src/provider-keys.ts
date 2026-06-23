import type { WorkerConfig } from "./config.js";
import { createApiClient } from "./api-client.js";

type ResolvedProviderKeys = {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  xaiApiKey?: string;
};

const normalize = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Ensures provider keys are available in `process.env` for the underlying SDK/CLIs.
 *
 * - Prefers already-set env vars (or config values loaded from env).
 * - If missing, attempts to fetch decrypted keys from the backend (DB) using worker auth.
 */
export const ensureProviderKeysInEnv = async (cfg: Pick<WorkerConfig, "apiUrl" | "apiKey" | "anthropicApiKey" | "openaiApiKey" | "xaiApiKey">): Promise<ResolvedProviderKeys> => {
  const envAnthropic = normalize(process.env.ANTHROPIC_API_KEY) ?? normalize(cfg.anthropicApiKey);
  const envOpenAI = normalize(process.env.OPENAI_API_KEY) ?? normalize(cfg.openaiApiKey);
  const envXAI = normalize(process.env.XAI_API_KEY) ?? normalize(cfg.xaiApiKey);

  if (envAnthropic) process.env.ANTHROPIC_API_KEY = envAnthropic;
  if (envOpenAI) process.env.OPENAI_API_KEY = envOpenAI;
  if (envXAI) process.env.XAI_API_KEY = envXAI;

  if (envAnthropic && envOpenAI && envXAI) {
    return { anthropicApiKey: envAnthropic, openaiApiKey: envOpenAI, xaiApiKey: envXAI };
  }

  // Best-effort: fetch missing keys from backend (DB).
  const client = createApiClient({ apiBaseUrl: cfg.apiUrl, apiKey: cfg.apiKey, timeoutMs: 15_000 });
  const resolved = await client.getProviderKeys(["anthropic", "openai", "xai"]);

  const finalAnthropic = envAnthropic ?? normalize(resolved.anthropicApiKey);
  const finalOpenAI = envOpenAI ?? normalize(resolved.openaiApiKey);
  const finalXAI = envXAI ?? normalize(resolved.xaiApiKey);

  if (finalAnthropic) process.env.ANTHROPIC_API_KEY = finalAnthropic;
  if (finalOpenAI) process.env.OPENAI_API_KEY = finalOpenAI;
  if (finalXAI) process.env.XAI_API_KEY = finalXAI;

  return { anthropicApiKey: finalAnthropic, openaiApiKey: finalOpenAI, xaiApiKey: finalXAI };
};

