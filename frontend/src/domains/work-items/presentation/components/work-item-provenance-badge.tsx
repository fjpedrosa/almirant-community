import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface WorkItemProvenanceBadgeProps {
  isAiProcessing: boolean;
  aiProvider?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function WorkItemProvenanceBadge({
  isAiProcessing,
  aiProvider,
  metadata,
}: WorkItemProvenanceBadgeProps) {
  if (!isAiProcessing) return null;

  const provider =
    aiProvider || (metadata as { aiProvider?: string } | null)?.aiProvider;
  const label =
    provider === "anthropic"
      ? "Claude"
      : provider === "openai"
        ? "Codex"
        : (provider ?? "AI");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="max-w-[60px] truncate">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        AI processing in progress
      </TooltipContent>
    </Tooltip>
  );
}
