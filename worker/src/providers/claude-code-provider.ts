import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildImplementationPrompt } from "./prompt-builder.js";
import { extractRetryAfterFromErrorMessage } from "./rate-limit-parser.js";
import type {
  AgentEnvironment,
  AgentHandle,
  AgentProviderConfig,
  AgentRateLimitInfo,
  AgentResult,
  AgentTaskInput,
  AgentProgress,
  CodingAgentProvider,
} from "./types.js";

type ClaudeCodeProviderConfig = {
  /** Optional override for the Claude model used by this provider */
  defaultModel?: string;
};

type ActiveRun = {
  abortController: AbortController;
  queryRef?: ReturnType<typeof query>;
};

const activeRuns = new Map<AgentHandle, ActiveRun>();

const nowIso = () => new Date().toISOString();

const withProjectId = (baseUrl: string, projectId?: string) => {
  if (!projectId) return baseUrl;
  try {
    const u = new URL(baseUrl);
    if (!u.searchParams.has("projectId")) u.searchParams.set("projectId", projectId);
    return u.toString();
  } catch {
    return baseUrl;
  }
};

const buildMcpServers = (env: AgentEnvironment) => {
  if (!env.mcpServerUrl) return undefined;

  const url = withProjectId(env.mcpServerUrl, env.projectId);
  const headers: Record<string, string> = {};
  if (env.mcpApiKey) headers.Authorization = `Bearer ${env.mcpApiKey}`;

  return {
    "almirant": {
      type: "http" as const,
      url,
      headers: Object.keys(headers).length ? headers : undefined,
    },
  };
};

const toProgress = (phase: AgentProgress["phase"], message: string): AgentProgress => ({
  phase,
  message,
  timestamp: nowIso(),
});

const safeTotalTokens = (usage: unknown) => {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const input = (u.input_tokens ?? u.inputTokens) as unknown;
  const output = (u.output_tokens ?? u.outputTokens) as unknown;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return input + output;
};

export const createClaudeCodeProvider = (config: ClaudeCodeProviderConfig = {}): CodingAgentProvider => {
  const abort = (handle: AgentHandle) => {
    const run = activeRuns.get(handle);
    if (!run) return;
    try {
      run.abortController.abort();
    } finally {
      try {
        run.queryRef?.close();
      } finally {
        activeRuns.delete(handle);
      }
    }
  };

  const execute: CodingAgentProvider["execute"] = async (
    task: AgentTaskInput,
    env: AgentEnvironment,
    providerConfig: AgentProviderConfig,
    onProgress?: (progress: AgentProgress) => void,
  ) => {
    const handle = crypto.randomUUID() as AgentHandle;
    const abortController = new AbortController();
    activeRuns.set(handle, { abortController });

    const prompt = buildImplementationPrompt(task, env);

    onProgress?.(toProgress("starting", "Starting Claude Code SDK query"));

    const queryOptions: Record<string, unknown> = {
      cwd: env.repoPath,
      abortController,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Claude Code supports named system prompt presets; keep the intent explicit here.
      systemPrompt: "claude_code",
      model: providerConfig.model ?? config.defaultModel,
      mcpServers: buildMcpServers(env),
    };

    if (providerConfig.resumeSessionId) {
      queryOptions.resume = providerConfig.resumeSessionId;
    }
    if (providerConfig.maxBudgetUsd != null) {
      queryOptions.maxBudgetUsd = providerConfig.maxBudgetUsd;
    }

    const q = query({
      prompt,
      options: queryOptions as Parameters<typeof query>[0]["options"],
    });

    const run = activeRuns.get(handle);
    if (run) run.queryRef = q;

    const filesChanged = new Set<string>();
    let resultMsg: { success: boolean; durationMs: number; cost?: number; tokens?: number; summary: string } | null =
      null;
    let capturedRateLimitInfo: AgentRateLimitInfo | undefined;
    let capturedSessionId: string | undefined;
    let capturedTotalCostUsd: number | undefined;

    try {
      for await (const msg of q) {
        // Capture session_id from the SDK init system message.
        if (msg.type === "system" && msg.subtype === "init") {
          const initMsg = msg as Record<string, unknown>;
          if (typeof initMsg.session_id === "string") {
            capturedSessionId = initMsg.session_id;
          }
          continue;
        }

        if (msg.type === "system" && msg.subtype === "files_persisted") {
          for (const f of msg.files ?? []) filesChanged.add(f.filename);
          continue;
        }

        if (msg.type === "system" && msg.subtype === "status") {
          const status = msg.status ?? "working";
          onProgress?.(toProgress("implementing", `Status: ${status}`));
          continue;
        }

        // Capture rate limit information from assistant messages with rate_limit errors.
        // The Claude Agent SDK does not expose raw HTTP response headers, so we detect
        // rate limits reactively via the error field on SDKAssistantMessage.
        if (msg.type === "assistant") {
          const assistantMsg = msg as SDKAssistantMessage;
          if (assistantMsg.error === "rate_limit") {
            // Try to extract retry-after from the message content, if any text block exists.
            let retryAfterSeconds: number | undefined;
            const messageContent = assistantMsg.message?.content;
            if (Array.isArray(messageContent)) {
              for (const block of messageContent) {
                if (typeof block === "object" && block !== null && "type" in block && block.type === "text" && "text" in block) {
                  retryAfterSeconds = extractRetryAfterFromErrorMessage(block.text as string);
                  if (retryAfterSeconds != null) break;
                }
              }
            }

            capturedRateLimitInfo = {
              provider: "anthropic",
              retryAfterSeconds,
              capturedAt: new Date().toISOString(),
            };

            const retryMsg = retryAfterSeconds != null ? `, retry after ${retryAfterSeconds}s` : "";
            onProgress?.(toProgress("implementing", `Rate limit detected${retryMsg}`));
          }
        }

        if (msg.type === "result") {
          const tokens = safeTotalTokens(msg.usage);
          const summary = msg.subtype === "success" ? msg.result : msg.errors.join("\n");
          resultMsg = {
            success: msg.subtype === "success",
            durationMs: msg.duration_ms,
            cost: msg.total_cost_usd,
            tokens,
            summary,
          };

          if (typeof msg.total_cost_usd === "number") {
            capturedTotalCostUsd = msg.total_cost_usd;
          }

          // Also check error result messages for rate limit signals in the error text.
          if (msg.subtype !== "success" && !capturedRateLimitInfo) {
            for (const errorText of msg.errors) {
              const retryAfter = extractRetryAfterFromErrorMessage(errorText);
              if (retryAfter != null || errorText.toLowerCase().includes("rate limit")) {
                capturedRateLimitInfo = {
                  provider: "anthropic",
                  retryAfterSeconds: retryAfter,
                  capturedAt: new Date().toISOString(),
                };
                break;
              }
            }
          }
        }
      }
    } finally {
      // Ensure cleanup even if the async iterator throws.
      activeRuns.delete(handle);
      try {
        q.close();
      } catch {
        // ignore
      }
    }

    const fallback: AgentResult = {
      success: false,
      filesChanged: Array.from(filesChanged),
      durationMs: 0,
      summary: "Claude Code provider finished without a result message.",
      rateLimitInfo: capturedRateLimitInfo,
      sessionId: capturedSessionId,
      totalCostUsd: capturedTotalCostUsd,
    };

    const finalResult: AgentResult = resultMsg
      ? {
          success: resultMsg.success,
          filesChanged: Array.from(filesChanged),
          durationMs: resultMsg.durationMs,
          cost: resultMsg.cost,
          tokens: resultMsg.tokens,
          summary: resultMsg.summary,
          rateLimitInfo: capturedRateLimitInfo,
          sessionId: capturedSessionId,
          totalCostUsd: capturedTotalCostUsd,
        }
      : fallback;

    return { result: finalResult, handle };
  };

  return { execute, abort };
};
