export type AiProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "zai"
  | "xai";

export interface AiModelPricing {
  provider: AiProvider;
  /**
   * Canonical model id (used for display and exact lookups).
   * Real session.model values can include snapshots; use `matches` for fuzzy matching.
   */
  model: string;
  label: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /**
   * If set, used to match snapshot/alias model ids (e.g. "claude-sonnet-4-5-20250929").
   */
  matches?: (modelId: string) => boolean;
}

// Source of truth:
// - Anthropic/OpenAI official pricing pages
// - Z.AI pricing page (https://docs.z.ai/guides/overview/pricing) verified on 2026-04-26
const AI_MODEL_PRICING: AiModelPricing[] = [
  // Anthropic (Claude)
  // NOTE: order matters for fuzzy matching — the legacy "claude-opus-4" catch-all below
  // matches m.includes("claude-opus-4-"), so newer opus entries MUST come before it.
  {
    provider: "anthropic",
    model: "claude-fable-5",
    label: "Claude Fable 5",
    inputUsdPerMTok: 10,
    outputUsdPerMTok: 50,
    matches: (m) => m.includes("claude-fable-5") || m.includes("fable-5"),
  },
  {
    provider: "anthropic",
    model: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    matches: (m) => m.includes("claude-opus-4-8") || m.includes("opus-4-8"),
  },
  {
    provider: "anthropic",
    model: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    matches: (m) => m.includes("claude-opus-4-7") || m.includes("opus-4-7"),
  },
  {
    provider: "anthropic",
    model: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    matches: (m) => m.includes("claude-opus-4-6") || m.includes("opus-4-6"),
  },
  {
    provider: "anthropic",
    model: "claude-opus-4-5",
    label: "Claude Opus 4.5",
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 25,
    matches: (m) => m.includes("claude-opus-4-5") || m.includes("opus-4-5"),
  },
  {
    provider: "anthropic",
    model: "claude-opus-4",
    label: "Claude Opus 4",
    inputUsdPerMTok: 15,
    outputUsdPerMTok: 75,
    matches: (m) => m === "claude-opus-4" || m.includes("opus-4") || m.includes("claude-opus-4-"),
  },
  {
    provider: "anthropic",
    // List price ($3/$15). Anthropic's introductory pricing ($2/$10 through 2026-08-31)
    // is intentionally not modeled to keep cost estimates stable.
    model: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    matches: (m) => m.includes("claude-sonnet-5") || m.includes("sonnet-5"),
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    matches: (m) => m.includes("claude-sonnet-4-6") || m.includes("sonnet-4-6"),
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    matches: (m) => m.includes("claude-sonnet-4-5") || m.includes("sonnet-4-5"),
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    matches: (m) => m === "claude-sonnet-4" || m.includes("claude-sonnet-4-") || m.includes("sonnet-4"),
  },
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 5,
    matches: (m) => m.includes("claude-haiku-4-5") || m.includes("haiku-4-5"),
  },

  // OpenAI — Current models
  {
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 30,
    matches: (m) => m === "gpt-5.5" || m.startsWith("gpt-5.5-20"),
  },
  {
    provider: "openai",
    model: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    inputUsdPerMTok: 30,
    outputUsdPerMTok: 180,
    matches: (m) => m === "gpt-5.5-pro" || m.startsWith("gpt-5.5-pro-20"),
  },
  {
    provider: "openai",
    model: "gpt-5.4",
    label: "GPT-5.4",
    inputUsdPerMTok: 2.5,
    outputUsdPerMTok: 15,
    matches: (m) => m === "gpt-5.4",
  },
  {
    provider: "openai",
    model: "gpt-5.4-pro",
    label: "GPT-5.4 Pro",
    inputUsdPerMTok: 30,
    outputUsdPerMTok: 180,
    matches: (m) => m === "gpt-5.4-pro",
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    inputUsdPerMTok: 0.75,
    outputUsdPerMTok: 4.5,
    matches: (m) => m === "gpt-5.4-mini",
  },
  {
    provider: "openai",
    model: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 1.25,
    matches: (m) => m === "gpt-5.4-nano",
  },
  {
    provider: "openai",
    model: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    inputUsdPerMTok: 2.5,
    outputUsdPerMTok: 15,
    matches: (m) => m === "gpt-5.3-codex",
  },
  {
    provider: "openai",
    model: "gpt-5.2",
    label: "GPT-5.2",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 8,
    matches: (m) => m === "gpt-5.2" || m.startsWith("gpt-5.2-chat"),
  },
  {
    provider: "openai",
    model: "gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 8,
    matches: (m) => m === "gpt-5.2-codex",
  },
  {
    provider: "openai",
    model: "gpt-5",
    label: "GPT-5",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 8,
    matches: (m) => m === "gpt-5",
  },
  {
    provider: "openai",
    model: "gpt-5-mini",
    label: "GPT-5 Mini",
    inputUsdPerMTok: 0.75,
    outputUsdPerMTok: 3,
    matches: (m) => m === "gpt-5-mini",
  },
  {
    provider: "openai",
    model: "o3",
    label: "o3",
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 4,
    matches: (m) => m === "o3",
  },
  {
    provider: "openai",
    model: "o4-mini",
    label: "o4 Mini",
    inputUsdPerMTok: 1.1,
    outputUsdPerMTok: 4.4,
    matches: (m) => m === "o4-mini",
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    label: "GPT-4.1",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 8,
    matches: (m) => m === "gpt-4.1",
  },
  {
    provider: "openai",
    model: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    inputUsdPerMTok: 0.4,
    outputUsdPerMTok: 1.6,
    matches: (m) => m === "gpt-4.1-mini",
  },
  {
    provider: "openai",
    model: "gpt-4.1-nano",
    label: "GPT-4.1 Nano",
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.4,
    matches: (m) => m === "gpt-4.1-nano",
  },

  // OpenAI — Legacy models (kept for historical session cost calculations)
  {
    provider: "openai",
    model: "gpt-4o",
    label: "GPT-4o",
    inputUsdPerMTok: 2.5,
    outputUsdPerMTok: 10,
    matches: (m) => m === "gpt-4o",
  },
  {
    provider: "openai",
    model: "gpt-4o-2024-05-13",
    label: "GPT-4o (2024-05-13)",
    inputUsdPerMTok: 5,
    outputUsdPerMTok: 15,
    matches: (m) => m === "gpt-4o-2024-05-13",
  },
  {
    provider: "openai",
    model: "o1",
    label: "o1",
    inputUsdPerMTok: 15,
    outputUsdPerMTok: 60,
    matches: (m) => m === "o1",
  },
  {
    provider: "openai",
    model: "o3-mini",
    label: "o3-mini",
    inputUsdPerMTok: 1.1,
    outputUsdPerMTok: 4.4,
    matches: (m) => m === "o3-mini",
  },

  // Google (Gemini)
  {
    provider: "google",
    model: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 12,
    matches: (m) => m === "gemini-3.1-pro-preview" || m.startsWith("gemini-3.1-pro"),
  },
  {
    provider: "google",
    model: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    inputUsdPerMTok: 1.5,
    outputUsdPerMTok: 9,
    matches: (m) => m === "gemini-3.5-flash" || m.startsWith("gemini-3.5-flash-"),
  },
  {
    provider: "google",
    model: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 1.5,
    matches: (m) => m === "gemini-3.1-flash-lite" || m.startsWith("gemini-3.1-flash-lite"),
  },
  {
    provider: "google",
    model: "gemini-3-flash-preview",
    label: "Gemini 3 Flash (Preview)",
    inputUsdPerMTok: 0.5,
    outputUsdPerMTok: 3,
    matches: (m) => m === "gemini-3-flash-preview" || m.startsWith("gemini-3-flash-preview"),
  },
  {
    provider: "google",
    model: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    inputUsdPerMTok: 1.25,
    outputUsdPerMTok: 10,
    matches: (m) => m === "gemini-2.5-pro" || m.startsWith("gemini-2.5-pro-"),
  },
  // NOTE: flash-lite MUST come before flash — "gemini-2.5-flash-lite"
  // startsWith("gemini-2.5-flash-") would otherwise be caught by the flash entry.
  {
    provider: "google",
    model: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.4,
    matches: (m) => m === "gemini-2.5-flash-lite" || m.startsWith("gemini-2.5-flash-lite"),
  },
  {
    provider: "google",
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    inputUsdPerMTok: 0.3,
    outputUsdPerMTok: 2.5,
    matches: (m) => m === "gemini-2.5-flash" || m.startsWith("gemini-2.5-flash-"),
  },

  // Z.AI (GLM family)
  {
    provider: "zai",
    model: "glm-5.2",
    label: "GLM-5.2",
    inputUsdPerMTok: 1.4,
    outputUsdPerMTok: 4.4,
    matches: (m) => m === "glm-5.2" || m.startsWith("glm-5.2-"),
  },
  {
    provider: "zai",
    model: "glm-5.1",
    label: "GLM-5.1",
    inputUsdPerMTok: 1.4,
    outputUsdPerMTok: 4.4,
    matches: (m) => m === "glm-5.1" || m.startsWith("glm-5.1-"),
  },
  {
    provider: "zai",
    model: "glm-5-turbo",
    label: "GLM-5 Turbo",
    inputUsdPerMTok: 1.2,
    outputUsdPerMTok: 4,
    matches: (m) => m === "glm-5-turbo" || m.startsWith("glm-5-turbo-"),
  },
  {
    provider: "zai",
    model: "glm-5v-turbo",
    label: "GLM-5V-Turbo",
    inputUsdPerMTok: 1.2,
    outputUsdPerMTok: 4,
    matches: (m) => m === "glm-5v-turbo" || m.startsWith("glm-5v-turbo-"),
  },
  {
    provider: "zai",
    model: "glm-5",
    label: "GLM-5",
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 3.2,
    matches: (m) => m === "glm-5",
  },
  {
    provider: "zai",
    model: "glm-5-code",
    label: "GLM-5-Code",
    inputUsdPerMTok: 1.2,
    outputUsdPerMTok: 5,
    matches: (m) => m === "glm-5-code" || m.startsWith("glm-5-code-"),
  },
  {
    provider: "zai",
    model: "glm-4.7",
    label: "GLM-4.7",
    inputUsdPerMTok: 0.6,
    outputUsdPerMTok: 2.2,
    matches: (m) => m === "glm-4.7" || m.startsWith("glm-4.7-20"),
  },
  {
    provider: "zai",
    model: "glm-4.7-flashx",
    label: "GLM-4.7-FlashX",
    inputUsdPerMTok: 0.07,
    outputUsdPerMTok: 0.4,
    matches: (m) => m === "glm-4.7-flashx" || m.startsWith("glm-4.7-flashx-"),
  },
  {
    provider: "zai",
    model: "glm-4.7-flash",
    label: "GLM-4.7-Flash",
    inputUsdPerMTok: 0,
    outputUsdPerMTok: 0,
    matches: (m) => m === "glm-4.7-flash" || m.startsWith("glm-4.7-flash-"),
  },
  {
    provider: "zai",
    model: "glm-4.6",
    label: "GLM-4.6",
    inputUsdPerMTok: 0.6,
    outputUsdPerMTok: 2.2,
    matches: (m) => m === "glm-4.6" || m.startsWith("glm-4.6-20"),
  },
  {
    provider: "zai",
    model: "glm-4.5",
    label: "GLM-4.5",
    inputUsdPerMTok: 0.6,
    outputUsdPerMTok: 2.2,
    matches: (m) => m === "glm-4.5" || m.startsWith("glm-4.5-20"),
  },
  {
    provider: "zai",
    model: "glm-4.5-x",
    label: "GLM-4.5-X",
    inputUsdPerMTok: 2.2,
    outputUsdPerMTok: 8.9,
    matches: (m) => m === "glm-4.5-x" || m.startsWith("glm-4.5-x-"),
  },
  {
    provider: "zai",
    model: "glm-4.5-air",
    label: "GLM-4.5-Air",
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 1.1,
    matches: (m) => m === "glm-4.5-air" || m.startsWith("glm-4.5-air-"),
  },
  {
    provider: "zai",
    model: "glm-4.5-airx",
    label: "GLM-4.5-AirX",
    inputUsdPerMTok: 1.1,
    outputUsdPerMTok: 4.5,
    matches: (m) => m === "glm-4.5-airx" || m.startsWith("glm-4.5-airx-"),
  },
  {
    provider: "zai",
    model: "glm-4.5-flash",
    label: "GLM-4.5-Flash",
    inputUsdPerMTok: 0,
    outputUsdPerMTok: 0,
    matches: (m) => m === "glm-4.5-flash" || m.startsWith("glm-4.5-flash-"),
  },
  {
    provider: "zai",
    model: "glm-4-32b-0414-128k",
    label: "GLM-4-32B-0414-128K",
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.1,
    matches: (m) => m === "glm-4-32b-0414-128k",
  },
  {
    provider: "zai",
    model: "glm-4.6v",
    label: "GLM-4.6V",
    inputUsdPerMTok: 0.3,
    outputUsdPerMTok: 0.9,
    matches: (m) => m === "glm-4.6v" || m.startsWith("glm-4.6v-20"),
  },
  {
    provider: "zai",
    model: "glm-4.6v-flashx",
    label: "GLM-4.6V-FlashX",
    inputUsdPerMTok: 0.04,
    outputUsdPerMTok: 0.4,
    matches: (m) => m === "glm-4.6v-flashx" || m.startsWith("glm-4.6v-flashx-"),
  },
  {
    provider: "zai",
    model: "glm-4.6v-flash",
    label: "GLM-4.6V-Flash",
    inputUsdPerMTok: 0,
    outputUsdPerMTok: 0,
    matches: (m) => m === "glm-4.6v-flash" || m.startsWith("glm-4.6v-flash-"),
  },
  {
    provider: "zai",
    model: "glm-4.5v",
    label: "GLM-4.5V",
    inputUsdPerMTok: 0.6,
    outputUsdPerMTok: 1.8,
    matches: (m) => m === "glm-4.5v" || m.startsWith("glm-4.5v-"),
  },
  {
    provider: "zai",
    model: "glm-ocr",
    label: "GLM-OCR",
    inputUsdPerMTok: 0.03,
    outputUsdPerMTok: 0.03,
    matches: (m) => m === "glm-ocr" || m.startsWith("glm-ocr-"),
  },

  // Backward-compatible aliases for legacy GLM IDs used in older sessions.
  {
    provider: "zai",
    model: "glm-4",
    label: "GLM-4",
    inputUsdPerMTok: 0.6,
    outputUsdPerMTok: 2.2,
    matches: (m) => m === "glm-4",
  },
  {
    provider: "zai",
    model: "glm-4-plus",
    label: "GLM-4+",
    inputUsdPerMTok: 0.7,
    outputUsdPerMTok: 0.7,
    matches: (m) => m === "glm-4-plus",
  },
  {
    provider: "zai",
    model: "glm-4-air",
    label: "GLM-4 Air",
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 1.1,
    matches: (m) => m === "glm-4-air",
  },
  {
    provider: "zai",
    model: "glm-4-flash",
    label: "GLM-4 Flash",
    inputUsdPerMTok: 0,
    outputUsdPerMTok: 0,
    matches: (m) => m === "glm-4-flash",
  },
  {
    provider: "zai",
    model: "glm-z1",
    label: "GLM-Z1",
    inputUsdPerMTok: 0.7,
    outputUsdPerMTok: 2,
    matches: (m) => m === "glm-z1" || m.startsWith("glm-z1-20"),
  },
  {
    provider: "zai",
    model: "glm-z1-air",
    label: "GLM-Z1 Air",
    inputUsdPerMTok: 0.35,
    outputUsdPerMTok: 0.85,
    matches: (m) => m === "glm-z1-air" || m.startsWith("glm-z1-air-"),
  },
  {
    provider: "zai",
    model: "glm-z1-airx",
    label: "GLM-Z1 AirX",
    inputUsdPerMTok: 0.7,
    outputUsdPerMTok: 2,
    matches: (m) => m === "glm-z1-airx" || m.startsWith("glm-z1-airx-"),
  },
  {
    provider: "zai",
    model: "glm-z1-flash",
    label: "GLM-Z1 Flash",
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 0.5,
    matches: (m) => m === "glm-z1-flash" || m.startsWith("glm-z1-flash-"),
  },
  {
    provider: "zai",
    model: "glm-4v-plus",
    label: "GLM-4V+",
    inputUsdPerMTok: 0.7,
    outputUsdPerMTok: 0.7,
    matches: (m) => m === "glm-4v-plus",
  },
  {
    provider: "zai",
    model: "glm-4.1v",
    label: "GLM-4.1V",
    inputUsdPerMTok: 0.8,
    outputUsdPerMTok: 2,
    matches: (m) => m === "glm-4.1v",
  },
  {
    provider: "xai",
    model: "grok-4.3",
    label: "Grok 4.3",
    inputUsdPerMTok: 1.25,
    outputUsdPerMTok: 2.5,
    matches: (m) => m.includes("grok-4.3"),
  },
  // NOTE: order matters — the "grok-4.20" base catch-all below matches
  // m.includes("grok-4.20"), so the more specific 4.20 variants MUST come first.
  {
    provider: "xai",
    model: "grok-4.20-multi-agent",
    label: "Grok 4.20 Multi-Agent",
    inputUsdPerMTok: 1.25,
    outputUsdPerMTok: 2.5,
    matches: (m) => m.includes("grok-4.20-multi-agent"),
  },
  {
    provider: "xai",
    model: "grok-4.20-reasoning",
    label: "Grok 4.20 Reasoning",
    inputUsdPerMTok: 1.25,
    outputUsdPerMTok: 2.5,
    matches: (m) => m.includes("grok-4.20-reasoning"),
  },
  {
    provider: "xai",
    model: "grok-4.20",
    label: "Grok 4.20",
    inputUsdPerMTok: 1.25,
    outputUsdPerMTok: 2.5,
    matches: (m) => m.includes("grok-4.20"),
  },
  {
    provider: "xai",
    model: "grok-build-0.1",
    label: "Grok Build 0.1",
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 2,
    matches: (m) => m.includes("grok-build-0.1"),
  },
  {
    provider: "xai",
    model: "grok-code-fast-1",
    label: "Grok Code Fast 1",
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 1.5,
    matches: (m) => m.includes("grok-code-fast-1"),
  },
  {
    provider: "xai",
    model: "grok-4-fast-reasoning",
    label: "Grok 4 Fast Reasoning",
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 0.5,
    matches: (m) => m.includes("grok-4-fast-reasoning") || m.includes("grok-4-1-fast"),
  },
];

const normalizeModelId = (modelId: string): string => modelId.trim().toLowerCase();
const normalizeProviderId = (providerId: string): string =>
  providerId.trim().toLowerCase().replace(/_/g, "-");

export const listAiModelPricing = (): AiModelPricing[] => AI_MODEL_PRICING.slice();

export const getAiModelPricing = (provider: string, model: string): AiModelPricing | null => {
  const m = normalizeModelId(model);
  const p = normalizeProviderId(provider);
  const providerCandidates = new Set<AiProvider>();

  if (p === "zai") {
    providerCandidates.add("zai");
    providerCandidates.add("openai");
  } else if (p === "xai" || p === "grok") {
    providerCandidates.add("xai");
  } else {
    providerCandidates.add(p as AiProvider);
  }

  for (const candidateProvider of providerCandidates) {
    const exact = AI_MODEL_PRICING.find(
      (x) => x.provider === candidateProvider && x.model === m,
    );
    if (exact) return exact;
  }

  for (const candidateProvider of providerCandidates) {
    const fuzzy = AI_MODEL_PRICING.find(
      (x) => x.provider === candidateProvider && x.matches?.(m),
    );
    if (fuzzy) return fuzzy;
  }

  return null;
};

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Cache-token pricing multipliers, applied against the provider's input rate.
 * Sources:
 *   - Anthropic: https://docs.anthropic.com/en/docs/prompt-caching (read 10%, write 125%)
 *   - OpenAI:   https://platform.openai.com/docs/pricing (cached input 50% for most models;
 *               cache writes are billed at standard input rate)
 *   - Z.AI:     published pricing mirrors the Anthropic cache economics
 *   - Google:   Gemini context caching is roughly 25% read and 100% write of input rate
 */
const CACHE_READ_MULTIPLIER_BY_PROVIDER: Record<AiProvider, number> = {
  anthropic: 0.1,
  openai: 0.5,
  google: 0.25,
  zai: 0.1,
  xai: 0.25,
};

const CACHE_CREATION_MULTIPLIER_BY_PROVIDER: Record<AiProvider, number> = {
  anthropic: 1.25,
  openai: 1.0,
  google: 1.0,
  zai: 1.25,
  xai: 1.0,
};

export const calculateCostUsd = (params: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}): number | null => {
  const pricing = getAiModelPricing(params.provider, params.model);
  if (!pricing) return null;

  const cacheRead = params.cacheReadInputTokens ?? 0;
  const cacheCreation = params.cacheCreationInputTokens ?? 0;
  const readMultiplier = CACHE_READ_MULTIPLIER_BY_PROVIDER[pricing.provider];
  const writeMultiplier = CACHE_CREATION_MULTIPLIER_BY_PROVIDER[pricing.provider];

  const inputCost = (params.inputTokens * pricing.inputUsdPerMTok) / 1_000_000;
  const outputCost = (params.outputTokens * pricing.outputUsdPerMTok) / 1_000_000;
  const cacheReadCost = (cacheRead * pricing.inputUsdPerMTok * readMultiplier) / 1_000_000;
  const cacheCreationCost = (cacheCreation * pricing.inputUsdPerMTok * writeMultiplier) / 1_000_000;

  return round6(inputCost + outputCost + cacheReadCost + cacheCreationCost);
};
