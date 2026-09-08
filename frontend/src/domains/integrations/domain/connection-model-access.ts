import { getModelsForProvider } from "@/lib/ai-models-catalog";
import type { ModelDefinition } from "./types";

/**
 * Z.AI connections are consumed by the Coding Plan agent runtime, while OpenAI
 * API connections must expose only models available through the general API.
 */
export const getModelsForAiConnection = (provider: string): ModelDefinition[] => {
  const normalizedProvider = provider.trim().toLowerCase();
  const accessChannel =
    normalizedProvider === "zai"
      ? "agent-runtime"
      : normalizedProvider === "openai"
        ? "general-api"
        : undefined;

  return getModelsForProvider(provider, accessChannel);
};

/** Return the canonical selectable model id, or omit an unsupported value. */
export const normalizeAiConnectionModel = (
  provider: string,
  model: string | null | undefined,
): string | undefined => {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return undefined;

  return getModelsForAiConnection(provider).find(
    (candidate) => candidate.id.toLowerCase() === normalized,
  )?.id;
};
