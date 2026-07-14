import type { ModelDefinition, ProviderType } from "@/domains/integrations/domain/types";

/**
 * Comprehensive catalog of AI models updated for July 2026.
 * Only currently-available (non-deprecated) models are listed, organized by
 * provider with display names and categories for UI components.
 */

// Anthropic models - July 2026 (verified against platform.claude.com models + pricing)
// Order matters: use-model-selector picks the FIRST entry as the default selection,
// so Opus 4.8 (the claude-code default) must stay first. Fable 5 is the most capable
// model but is intentionally NOT the default (premium price + 30-day retention).
const ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    id: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    category: "best",
  },
  {
    // Most capable widely-released model ($10/$50 MTok, 1M context, 128K output).
    // Thinking is always on and it requires 30-day data retention — keep it
    // opt-in (never the default selection).
    id: "claude-fable-5",
    displayName: "Claude Fable 5",
    category: "best",
  },
  {
    id: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    category: "reasoning",
  },
  {
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    category: "fast",
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    category: "cheap",
  },
];

// OpenAI models - July 2026 (verified against OpenAI models + pricing pages)
const OPENAI_MODELS: ModelDefinition[] = [
  {
    id: "gpt-5.5",
    displayName: "GPT-5.5",
    category: "best",
  },
  {
    id: "gpt-5.5-pro",
    displayName: "GPT-5.5 Pro",
    category: "reasoning",
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    category: "fast",
  },
  {
    id: "gpt-5.4-pro",
    displayName: "GPT-5.4 Pro",
    category: "reasoning",
  },
  {
    id: "gpt-5.4-mini",
    displayName: "GPT-5.4 Mini",
    category: "fast",
  },
  {
    id: "gpt-5.4-nano",
    displayName: "GPT-5.4 Nano",
    category: "cheap",
  },
  {
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    category: "reasoning",
  },
  {
    id: "gpt-4.1",
    displayName: "GPT-4.1",
    category: "fast",
  },
  {
    id: "gpt-4.1-mini",
    displayName: "GPT-4.1 Mini",
    category: "cheap",
  },
];

// Google models - July 2026 (verified against ai.google.dev models + pricing)
const GOOGLE_MODELS: ModelDefinition[] = [
  {
    id: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro",
    category: "best",
  },
  {
    id: "gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    category: "fast",
  },
  {
    id: "gemini-3.1-flash-lite",
    displayName: "Gemini 3.1 Flash-Lite",
    category: "cheap",
  },
  {
    id: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash",
    category: "fast",
  },
  {
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    category: "reasoning",
  },
  {
    id: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    category: "fast",
  },
  {
    id: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash-Lite",
    category: "cheap",
  },
];

// OpenAI-compatible models (current z.ai GLM catalog, verified against z.ai pricing)
// GLM-5.2 is the flagship and the zai default.
const OPENAI_COMPATIBLE_MODELS: ModelDefinition[] = [
  {
    id: "glm-5.2",
    displayName: "GLM-5.2",
    category: "best",
  },
  {
    id: "glm-5.1",
    displayName: "GLM-5.1",
    category: "reasoning",
  },
  {
    id: "glm-5",
    displayName: "GLM-5",
    category: "reasoning",
  },
  {
    id: "glm-5-turbo",
    displayName: "GLM-5 Turbo",
    category: "fast",
  },
  {
    id: "glm-5v-turbo",
    displayName: "GLM-5V Turbo",
    category: "fast",
  },
  {
    id: "glm-4.7",
    displayName: "GLM-4.7",
    category: "cheap",
  },
  {
    id: "glm-4.7-flashx",
    displayName: "GLM-4.7-FlashX",
    category: "cheap",
  },
  {
    id: "glm-4.7-flash",
    displayName: "GLM-4.7-Flash",
    category: "cheap",
  },
  {
    id: "glm-4.6v",
    displayName: "GLM-4.6V",
    category: "reasoning",
  },
  {
    id: "glm-4.6v-flashx",
    displayName: "GLM-4.6V-FlashX",
    category: "cheap",
  },
  {
    id: "glm-4.6v-flash",
    displayName: "GLM-4.6V-Flash",
    category: "cheap",
  },
  {
    id: "glm-ocr",
    displayName: "GLM-OCR",
    category: "cheap",
  },
];

// ZAI models (same as OpenAI-compatible for now)
const ZAI_MODELS: ModelDefinition[] = OPENAI_COMPATIBLE_MODELS;

// xAI Grok models - July 2026 (verified against docs.x.ai; grok-4.3 is the flagship
// and every retired legacy slug now redirects to it).
// NOTE: docs.x.ai lists dated snapshots (e.g. grok-4.20-0309-*). The undated aliases
// below resolve today; confirm the exact grok-4.20 id against a live API key before prod.
const XAI_MODELS: ModelDefinition[] = [
  {
    id: "grok-4.3",
    displayName: "Grok 4.3",
    category: "best",
  },
  {
    id: "grok-4.20-reasoning",
    displayName: "Grok 4.20 Reasoning",
    category: "reasoning",
  },
  {
    id: "grok-4.20-multi-agent",
    displayName: "Grok 4.20 Multi-Agent",
    category: "reasoning",
  },
  {
    id: "grok-4.20",
    displayName: "Grok 4.20",
    category: "fast",
  },
  {
    id: "grok-build-0.1",
    displayName: "Grok Build 0.1",
    category: "cheap",
  },
];


/**
 * Master catalog mapping provider types to their available models
 */
export const AI_MODELS_CATALOG: Record<string, ModelDefinition[]> = {
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  google: GOOGLE_MODELS,
  zai: ZAI_MODELS,
  xai: XAI_MODELS,
  grok: XAI_MODELS, // Alias for xAI/Grok
  zipu: ZAI_MODELS, // Alias for zai
};

/**
 * Get available models for a specific provider
 */
export const getModelsForProvider = (provider: ProviderType | string): ModelDefinition[] => {
  return AI_MODELS_CATALOG[provider] ?? [];
};

/**
 * Get legacy model IDs for backwards compatibility
 * @param provider The provider type
 * @returns Array of model IDs (strings) for use with existing PROVIDER_MODELS structure
 */
export const getLegacyModelIdsForProvider = (provider: ProviderType | string): string[] => {
  return getModelsForProvider(provider).map(model => model.id);
};

/**
 * Find a model definition by ID across all providers
 */
export const findModelById = (modelId: string): ModelDefinition | null => {
  for (const models of Object.values(AI_MODELS_CATALOG)) {
    const model = models.find(m => m.id === modelId);
    if (model) return model;
  }
  return null;
};

/**
 * Resolve a raw model string to its canonical catalog id.
 *
 * Handles the two ways a value drifts out of sync with the `<Select>` options:
 * 1. It was stored with the display-name casing (e.g. "GLM-5.2" instead of the
 *    id "glm-5.2") — the original cause of the "Select model" placeholder bug.
 * 2. It is a dated snapshot id (e.g. "glm-5.2-250828") that maps onto a base id.
 *
 * Returns null when nothing in the catalog matches.
 */
export const resolveCanonicalModelId = (
  raw: string | null | undefined,
): string | null => {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;

  const all: ModelDefinition[] = [];
  const seen = new Set<string>();
  for (const models of Object.values(AI_MODELS_CATALOG)) {
    for (const model of models) {
      if (!seen.has(model.id)) {
        seen.add(model.id);
        all.push(model);
      }
    }
  }

  const byId = all.find((m) => m.id.toLowerCase() === needle);
  if (byId) return byId.id;

  const byDisplayName = all.find((m) => m.displayName.toLowerCase() === needle);
  if (byDisplayName) return byDisplayName.id;

  // Dated snapshots resolve to their base id — prefer the longest (most
  // specific) prefix so "glm-5-turbo-*" wins over "glm-5-*".
  const prefixMatch = all
    .filter((m) => needle.startsWith(`${m.id.toLowerCase()}-`))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (prefixMatch) return prefixMatch.id;

  return null;
};

/**
 * Reconcile a form's current model value against the models available for the
 * currently-selected provider.
 *
 * Canonicalizes case/snapshot mismatches (so a persisted "GLM-5.2" survives as
 * "glm-5.2") instead of silently discarding a valid value; clears the value
 * only when it genuinely does not belong to the available set (e.g. the
 * provider changed and the old model no longer applies).
 */
export const reconcileModelWithAvailable = (
  current: string | null | undefined,
  availableIds: string[],
): string => {
  if (!current) return "";
  if (availableIds.includes(current)) return current;
  const canonical = resolveCanonicalModelId(current);
  if (canonical && availableIds.includes(canonical)) return canonical;
  return "";
};

/**
 * Get models grouped by category for a provider
 */
export const getModelsGroupedByCategory = (provider: ProviderType | string) => {
  const models = getModelsForProvider(provider);
  return models.reduce((acc, model) => {
    if (!acc[model.category]) {
      acc[model.category] = [];
    }
    acc[model.category].push(model);
    return acc;
  }, {} as Record<ModelDefinition["category"], ModelDefinition[]>);
};
