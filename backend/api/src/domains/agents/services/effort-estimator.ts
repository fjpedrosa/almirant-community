import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { logger } from "@almirant/config";
import {
  computeWorkItemContentHash,
  getActiveConfig,
  upsertEstimate,
  type EffortEstimatorConfig,
} from "@almirant/database";
import {
  generateStructuredJson,
  type AiProvider,
} from "../../ai/shared/services/structured-output";
import {
  createModel,
  resolveModelByPolicy,
  withAuthErrorDetection,
  getDefaultModel,
} from "../../ai/shared/services/model-factory";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EffortEstimationResult {
  /** 1..10 subagents the runner should spawn in parallel */
  estimatedSubagents: number;
  /** 256..65536 MB of memory per subagent */
  estimatedMemoryMb: number;
  /** Model-reported confidence */
  confidence: "low" | "medium" | "high";
  /** Free-form reasoning, bounded to 500 chars */
  reasoning: string;
}

export interface RunEffortEstimationParams {
  workItem: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    parentId: string | null;
    workspaceId?: string | null;
    parentType?: string | null;
  };
  children: Array<{
    id: string;
    title: string;
    type: string;
    agentHints?: string | null;
  }>;
  config: {
    provider: AiProvider;
    model: string;
    temperature: number;
    maxTokens: number;
    systemPrompt: string;
  };
  /** Optional acting user — required to resolve an org-scoped AI key. */
  userId?: string;
  /** If true, do not persist the result (used by preview endpoints). */
  dryRun?: boolean;
}

export interface RunEffortEstimationReturn {
  result: EffortEstimationResult;
  tokensUsed: number;
  latencyMs: number;
  contentHash: string;
  source: "llm" | "fallback_heuristic";
}

// ---------------------------------------------------------------------------
// Zod schema — the contract the LLM must satisfy
// ---------------------------------------------------------------------------

const resultSchema = z.object({
  estimatedSubagents: z.number().int().min(1).max(10),
  estimatedMemoryMb: z.number().int().min(256).max(65536),
  confidence: z.enum(["low", "medium", "high"]),
  reasoning: z.string().max(500),
});

// ---------------------------------------------------------------------------
// In-memory config cache (TTL 30s)
// ---------------------------------------------------------------------------

export type ActiveConfig = EffortEstimatorConfig;

interface CacheEntry {
  value: ActiveConfig;
  expiresAt: number;
}

let cachedConfig: CacheEntry | null = null;
const CONFIG_TTL_MS = 30_000;

/**
 * Returns the currently active effort-estimator config, cached in-memory for
 * `CONFIG_TTL_MS` ms. On a cache miss or expiry the active row is re-read
 * from the DB. Throws if no active config exists.
 */
export const getCachedActiveConfig = async (): Promise<ActiveConfig> => {
  const now = Date.now();
  if (cachedConfig && cachedConfig.expiresAt > now) {
    return cachedConfig.value;
  }

  const active = await getActiveConfig();
  if (!active) {
    throw new Error(
      "No active effort-estimator config found. Configure one in the admin panel before running an estimation.",
    );
  }

  cachedConfig = { value: active, expiresAt: now + CONFIG_TTL_MS };
  return active;
};

/**
 * Invalidates the in-memory active-config cache. Called by the admin PATCH
 * route after `updateActiveConfig` so the next estimation uses the new row.
 */
export const invalidateConfigCache = (): void => {
  cachedConfig = null;
};

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

interface PromptWorkItem {
  id: string;
  title: string;
  description: string | null;
  type: string;
  parentType?: string | null;
}

interface PromptChild {
  id: string;
  title: string;
  type: string;
  agentHints?: string | null;
}

/**
 * Builds the user message. Kept deterministic (no timestamps, no randomness)
 * so that dedup/regression tests on the prompt are stable.
 */
const buildPrompt = (
  workItem: PromptWorkItem,
  children: PromptChild[],
): string => {
  const childTitles = children.map((c) => c.title);
  const childAgentHints = children
    .map((c) => c.agentHints)
    .filter((hint): hint is string => typeof hint === "string" && hint.length > 0);

  const payload = {
    title: workItem.title,
    description: workItem.description ?? "",
    type: workItem.type,
    parentType: workItem.parentType ?? null,
    childCount: children.length,
    childTitles,
    childAgentHints,
  };

  return [
    "You are estimating the execution effort for a work item on the Almirant agent runner.",
    "Given the work item and its direct children below, decide how many subagents should run in parallel and how much memory each should receive.",
    "",
    "Work item data (JSON):",
    JSON.stringify(payload, null, 2),
    "",
    "Respond with a JSON object matching this shape exactly:",
    "{",
    '  "estimatedSubagents": integer 1..10,',
    '  "estimatedMemoryMb": integer 256..65536,',
    '  "confidence": "low" | "medium" | "high",',
    '  "reasoning": string (<=500 chars)',
    "}",
  ].join("\n");
};

// ---------------------------------------------------------------------------
// Fallback heuristic
// ---------------------------------------------------------------------------

const buildFallback = (
  children: ReadonlyArray<unknown>,
): EffortEstimationResult => {
  const childCount = children.length;
  return {
    estimatedSubagents: Math.max(1, Math.min(4, childCount || 1)),
    estimatedMemoryMb: Math.min(4, childCount || 1) * 500 + 1024,
    confidence: "low" as const,
    reasoning: "LLM failed 3 times — fallback heuristic applied",
  };
};

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

interface ResolvedEstimatorModel {
  model: BaseChatModel;
  /** null when we used the env-based default model (no provider connection) */
  connectionId: string | null;
}

/**
 * Resolve a LangChain chat model honoring the org AI-key policy when we have
 * a user+org context. Falls back to the env default (OPENAI_API_KEY) only
 * when there is no user/org and provider is "openai".
 *
 * Temperature + maxTokens are applied via `.bind()` so they surface to the
 * provider call without having to plumb them through `createModel`.
 */
const resolveEstimatorModel = async (
  config: RunEffortEstimationParams["config"],
  userId: string | undefined,
  workspaceId: string | null | undefined,
): Promise<ResolvedEstimatorModel> => {
  if (userId && workspaceId) {
    const resolved = await resolveModelByPolicy({
      provider: config.provider,
      userId,
      workspaceId,
      modelName: config.model,
    });

    if (resolved) {
      const bound = bindModelParams(
        resolved.model,
        config.provider,
        config.temperature,
        config.maxTokens,
      );
      return { model: bound, connectionId: resolved.connectionId };
    }
  }

  // No org key available — fall back to env default only for OpenAI. For
  // other providers we can't build a model without an API key.
  if (config.provider === "openai") {
    const model = getDefaultModel() as unknown as BaseChatModel;
    const bound = bindModelParams(
      model,
      config.provider,
      config.temperature,
      config.maxTokens,
    );
    return { model: bound, connectionId: null };
  }

  throw new Error(
    `No provider connection available for ${config.provider} and no env default configured.`,
  );
};

/**
 * Binds temperature + maxTokens on the LangChain model. The kwarg names
 * differ by provider:
 *  - OpenAI-compatible (openai/google/zai): `temperature`, `max_tokens`
 *  - Anthropic: `temperature`, `max_tokens`
 */
const bindModelParams = (
  model: BaseChatModel,
  _provider: AiProvider,
  temperature: number,
  maxTokens: number,
): BaseChatModel => {
  const bindable = model as BaseChatModel & {
    bind?: (kwargs: Record<string, unknown>) => BaseChatModel;
  };
  if (typeof bindable.bind !== "function") return model;
  return bindable.bind({
    temperature,
    max_tokens: maxTokens,
  });
};

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Runs a single effort estimation.
 *
 * Success path:
 *  1. Build the prompt from the work item + children.
 *  2. Compute a deterministic content hash (title/description/type/parentId/childIds).
 *  3. Resolve the provider model (org policy or env default) and bind temp/tokens.
 *  4. Call `generateStructuredJson` which handles its own Zod retry loop.
 *  5. Persist via `upsertEstimate` unless `dryRun` is set.
 *
 * Failure path (any non-auth LLM error or exhausted retries):
 *  - Computes a fallback heuristic from the child count.
 *  - Persists with `source: "fallback_heuristic"` unless `dryRun` is set.
 *
 * Auth errors bubble through `withAuthErrorDetection` so the provider
 * connection can be suspended — they still trigger the fallback heuristic
 * on the estimator side so the caller always receives a result.
 */
export const runEffortEstimation = async (
  params: RunEffortEstimationParams,
): Promise<RunEffortEstimationReturn> => {
  const { workItem, children, config, userId, dryRun = false } = params;
  const start = Date.now();

  const contentHash = computeWorkItemContentHash({
    title: workItem.title,
    description: workItem.description,
    type: workItem.type,
    parentId: workItem.parentId,
    childIds: children.map((c) => c.id),
  });

  const userPrompt = buildPrompt(
    {
      id: workItem.id,
      title: workItem.title,
      description: workItem.description,
      type: workItem.type,
      parentType: workItem.parentType ?? null,
    },
    children,
  );

  try {
    const resolved = await resolveEstimatorModel(
      config,
      userId,
      workItem.workspaceId,
    );

    const generate = async () =>
      generateStructuredJson({
        model: resolved.model as unknown as BaseLanguageModel,
        provider: config.provider,
        systemPrompt: config.systemPrompt,
        userPrompt,
        schema: resultSchema,
        maxRetries: 2,
      });

    const { result, tokensUsed, latencyMs } = resolved.connectionId
      ? await withAuthErrorDetection(resolved.connectionId, generate)
      : await generate();

    if (!dryRun) {
      await upsertEstimate({
        workItemId: workItem.id,
        estimatedSubagents: result.estimatedSubagents,
        estimatedMemoryMb: result.estimatedMemoryMb,
        confidence: result.confidence,
        reasoning: result.reasoning,
        contentHash,
        source: "llm",
      });
    }

    return {
      result,
      tokensUsed,
      latencyMs,
      contentHash,
      source: "llm",
    };
  } catch (err) {
    logger.warn(
      {
        workItemId: workItem.id,
        err: err instanceof Error ? err.message : String(err),
      },
      "Effort estimation LLM call failed; applying fallback heuristic",
    );

    const fallback = buildFallback(children);
    const latencyMs = Date.now() - start;

    if (!dryRun) {
      await upsertEstimate({
        workItemId: workItem.id,
        estimatedSubagents: fallback.estimatedSubagents,
        estimatedMemoryMb: fallback.estimatedMemoryMb,
        confidence: fallback.confidence,
        reasoning: fallback.reasoning,
        contentHash,
        source: "fallback_heuristic",
      });
    }

    return {
      result: fallback,
      tokensUsed: 0,
      latencyMs,
      contentHash,
      source: "fallback_heuristic",
    };
  }
};

// ---------------------------------------------------------------------------
// Internals exposed for tests only — NOT part of the public module contract.
// ---------------------------------------------------------------------------

export const __internals = {
  buildPrompt,
  buildFallback,
  resultSchema,
  createModel, // re-exported so tests can assert it is importable without side effects
};
