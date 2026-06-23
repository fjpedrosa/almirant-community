import { Cpu } from "lucide-react";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { ClaudeCodeIcon } from "@/components/icons/claude-code-icon";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { GrokIcon } from "@/components/icons/grok-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import type { AgentProvider } from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Normalized provider type used across the application.
 * Maps to the canonical provider names used in work-items and planning contexts.
 */
export type NormalizedProvider =
  | "anthropic"
  | "openai"
  | "zai"
  | "xai"
  | "grok"
  | "other";

/**
 * All known provider name variants that can appear in the codebase.
 * Includes both AgentProvider values and PlanningProvider values.
 */
export type ProviderVariant =
  | "anthropic"
  | "claude-code"
  | "openai"
  | "codex"
  | "zai"
  | "zipu"
  | "xai"
  | "x.ai"
  | "grok";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes any provider name variant to its canonical form.
 *
 * Mapping:
 * - "anthropic" | "claude-code" -> "anthropic"
 * - "openai" | "codex" -> "openai"
 * - "zai" | "zipu" -> "zai"
 * - "xai" | "x.ai" | "grok" -> "xai"
 * - any other string -> "other"
 */
export const normalizeProviderName = (
  provider: string | null | undefined
): NormalizedProvider => {
  if (!provider) return "other";

  const lower = provider.toLowerCase().trim();

  if (lower === "anthropic" || lower === "claude-code") return "anthropic";
  if (lower === "openai" || lower === "codex") return "openai";
  if (lower === "zai" || lower === "zipu" || lower === "z.ai" || lower === "zhipu" || lower === "zhipuai" || lower === "openai-compatible" || lower === "openai_compatible") return "zai";
  if (lower === "xai" || lower === "x.ai" || lower === "grok") return "xai";

  return "other";
};

// ---------------------------------------------------------------------------
// Icon Component Getter
// ---------------------------------------------------------------------------

type IconComponent = React.FC<{ className?: string }>;

const FallbackProviderIcon: IconComponent = ({ className }) => (
  <Cpu className={className ?? "h-4 w-4 text-muted-foreground"} />
);
FallbackProviderIcon.displayName = "FallbackProviderIcon";

/**
 * Returns the icon component for a given provider.
 * Use this when you need to apply dynamic className to the icon.
 *
 * @example
 * const Icon = getProviderIconComponent("claude-code");
 * return <Icon className={cn("h-4 w-4", isActive && "animate-pulse")} />;
 */
export const getProviderIconComponent = (
  provider: string | null | undefined
): IconComponent => {
  const normalized = normalizeProviderName(provider);

  switch (normalized) {
    case "anthropic":
      return AnthropicIcon;
    case "openai":
      return OpenAIIcon;
    case "zai":
      return ZAIIcon;
    case "xai":
      return XAIIcon;
    default:
      return FallbackProviderIcon;
  }
};

// ---------------------------------------------------------------------------
// Icon ReactNode Getter
// ---------------------------------------------------------------------------

/**
 * Returns a rendered icon for a given provider with optional className.
 * Use this for simple icon rendering without dynamic className needs.
 *
 * @example
 * <div className="flex items-center gap-1">
 *   {getProviderIcon("anthropic", "h-4 w-4")}
 *   <span>Anthropic</span>
 * </div>
 */
export const getProviderIcon = (
  provider: string | null | undefined,
  className?: string
): React.ReactNode => {
  const normalized = normalizeProviderName(provider);
  const iconClass = className ?? "h-4 w-4";

  switch (normalized) {
    case "anthropic":
      return <AnthropicIcon className={iconClass} />;
    case "openai":
      return <OpenAIIcon className={iconClass} />;
    case "zai":
      return <ZAIIcon className={iconClass} />;
    case "xai":
      return <XAIIcon className={iconClass} />;
    default:
      return <Cpu className={`${iconClass} text-muted-foreground`} />;
  }
};

// ---------------------------------------------------------------------------
// Model Icon Getter
// ---------------------------------------------------------------------------

const getProviderSearchText = (provider: string | null | undefined): string =>
  (provider ?? "").toLowerCase();

const getModelSearchText = (model: string | null | undefined): string =>
  (model ?? "").toLowerCase();

export const getModelIconComponent = (
  model: string | null | undefined,
  provider?: string | null
): IconComponent => {
  const modelValue = getModelSearchText(model);
  const providerValue = getProviderSearchText(provider);
  const fallbackValue = modelValue || providerValue;

  if (modelValue.includes("claude")) return ClaudeIcon;
  if (
    modelValue.includes("glm") ||
    modelValue.includes("z.ai") ||
    modelValue.includes("zai") ||
    modelValue.includes("zhipu") ||
    modelValue.includes("zipu")
  ) {
    return ZAIIcon;
  }
  if (modelValue.includes("grok")) return GrokIcon;
  if (
    modelValue.includes("gpt") ||
    modelValue.includes("openai") ||
    /\bo\d+(?:[-\s]|$)/.test(modelValue)
  ) {
    return OpenAIIcon;
  }
  if (modelValue.includes("x.ai") || modelValue.includes("xai")) return XAIIcon;

  if (fallbackValue.includes("claude")) return ClaudeIcon;
  if (
    fallbackValue.includes("z.ai") ||
    fallbackValue.includes("zai") ||
    fallbackValue.includes("zhipu") ||
    fallbackValue.includes("zipu")
  ) {
    return ZAIIcon;
  }
  if (fallbackValue.includes("openai") || fallbackValue.includes("codex")) {
    return OpenAIIcon;
  }
  if (fallbackValue.includes("x.ai") || fallbackValue.includes("xai")) return XAIIcon;

  return getProviderIconComponent(provider);
};

export const getModelIcon = (
  model: string | null | undefined,
  provider?: string | null,
  className?: string
): React.ReactNode => {
  const Icon = getModelIconComponent(model, provider);
  return <Icon className={className ?? "h-4 w-4"} />;
};

// ---------------------------------------------------------------------------
// Label Getter
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable label for a given provider.
 *
 * @example
 * getProviderLabel("claude-code") // => "Anthropic"
 * getProviderLabel("codex") // => "OpenAI"
 * getProviderLabel("zipu") // => "z.ai"
 */
export const getProviderLabel = (
  provider: string | null | undefined
): string => {
  const normalized = normalizeProviderName(provider);

  switch (normalized) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "zai":
      return "z.ai";
    case "xai":
      return "xAI";
    default:
      return "Unknown";
  }
};

/**
 * Returns a short label for a given provider (used in compact UI contexts).
 *
 * @example
 * getProviderShortLabel("claude-code") // => "Anthropic"
 * getProviderShortLabel("codex") // => "OpenAI"
 * getProviderShortLabel("zipu") // => "z.ai"
 */
export const getProviderShortLabel = (
  provider: string | null | undefined
): string => {
  if (!provider) return "AI";

  const lower = provider.toLowerCase().trim();

  // Return canonical AI provider names for agent-provider variants.
  if (lower === "claude-code") return "Anthropic";
  if (lower === "codex") return "OpenAI";
  if (lower === "zipu") return "z.ai";

  // For normalized provider names, return the standard label
  const normalized = normalizeProviderName(provider);
  switch (normalized) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "zai":
      return "z.ai";
    case "xai":
      return "xAI";
    default:
      return "AI";
  }
};

// ---------------------------------------------------------------------------
// Provider Options (for selector UIs)
// ---------------------------------------------------------------------------

/**
 * Options array for provider selector UI components.
 * Uses AgentProvider values which are the action-oriented variants.
 */
export const PROVIDER_OPTIONS: ReadonlyArray<{
  provider: AgentProvider;
  label: string;
  Icon: IconComponent;
}> = [
  { provider: "claude-code", label: "Anthropic", Icon: AnthropicIcon },
  { provider: "codex", label: "OpenAI", Icon: OpenAIIcon },
  { provider: "zipu", label: "z.ai", Icon: ZAIIcon },
  { provider: "grok", label: "xAI", Icon: XAIIcon },
] as const;

// ---------------------------------------------------------------------------
// AI Provider Labels (for work-item card participant display)
// ---------------------------------------------------------------------------

/**
 * Labels for AI participants in work-item cards.
 * Uses NormalizedProvider keys.
 */
export const AI_PROVIDER_LABELS: Record<NormalizedProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  zai: "z.ai",
  xai: "xAI",
  grok: "xAI",
  other: "AI",
};

// ---------------------------------------------------------------------------
// Metadata Provider Normalization (for work-item-card)
// ---------------------------------------------------------------------------

/**
 * Extracts and normalizes AI providers from work item metadata.
 * Handles legacy fields (managedBy, managedByAgents) and current (aiProvider).
 */
export const normalizeAiProvidersFromMetadata = (
  metadata: Record<string, unknown> | null | undefined
): NormalizedProvider[] => {
  if (!metadata) return [];

  const rawAiProvider = metadata.aiProvider;
  const rawManagedBy = metadata.managedBy; // legacy
  const rawManagedByAgents = metadata.managedByAgents; // legacy
  const values: string[] = [];

  if (typeof rawAiProvider === "string") {
    values.push(rawAiProvider);
  }

  if (typeof rawManagedBy === "string") {
    values.push(rawManagedBy);
  } else if (Array.isArray(rawManagedBy)) {
    values.push(
      ...rawManagedBy.filter((v): v is string => typeof v === "string")
    );
  }

  if (Array.isArray(rawManagedByAgents)) {
    values.push(
      ...rawManagedByAgents.filter((v): v is string => typeof v === "string")
    );
  } else if (typeof rawManagedByAgents === "string") {
    values.push(rawManagedByAgents);
  }

  const unique = new Set<NormalizedProvider>();
  for (const value of values) {
    const normalized = normalizeProviderName(value);
    unique.add(normalized);
  }

  return Array.from(unique);
};

/**
 * Gets the reserved AI provider from work item metadata.
 * Falls back to the first provider from normalized metadata if no explicit reservation.
 */
export const getReservedAiProviderFromMetadata = (
  metadata: Record<string, unknown> | null | undefined
): NormalizedProvider => {
  const explicit = (metadata as Record<string, unknown> | undefined)
    ?.aiReservationProvider;

  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return normalizeProviderName(explicit);
  }

  const providers = normalizeAiProvidersFromMetadata(metadata);
  return providers[0] ?? "other";
};

/**
 * Maps an AgentProvider to a NormalizedProvider.
 * Useful when bridging between agent job context and display context.
 */
export const mapAgentProviderToNormalized = (
  provider: AgentProvider | undefined
): NormalizedProvider => {
  if (!provider) return "other";

  switch (provider) {
    case "claude-code":
      return "anthropic";
    case "codex":
      return "openai";
    case "zipu":
      return "zai";
    case "grok":
      return "xai";
    default:
      return "other";
  }
};

// ---------------------------------------------------------------------------
// Coding Agent Icons (for agent selector UIs)
// ---------------------------------------------------------------------------

export const CODING_AGENT_ICON_MAP: Record<CodingAgent, IconComponent> = {
  "claude-code": ClaudeCodeIcon,
  "codex": CodexIcon,
  "opencode": OpenCodeIcon,
};

export const getCodingAgentIcon = (agent: CodingAgent): IconComponent =>
  CODING_AGENT_ICON_MAP[agent];

export const renderCodingAgentIcon = (agent: CodingAgent, className?: string): React.ReactElement => {
  const Icon = CODING_AGENT_ICON_MAP[agent];
  return <Icon className={className ?? "h-4 w-4"} />;
};
