import { getModelsForProvider } from "@/lib/ai-models-catalog";
import type { ModelDefinition } from "./types";

/**
 * Provider connections are consumed by coding-agent runtimes. Z.AI connections
 * in this UI are always Coding Plan connections, so API-only/VLM models must
 * never appear in their selectors or be persisted in their stage defaults.
 */
export const getModelsForAiConnection = (provider: string): ModelDefinition[] =>
  getModelsForProvider(
    provider,
    provider.trim().toLowerCase() === "zai" ? "agent-runtime" : undefined,
  );

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
