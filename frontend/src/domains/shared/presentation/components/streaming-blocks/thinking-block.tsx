import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { deriveReasoningHeadline } from "@/domains/shared/application/utils/reasoning-run-utils";

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  thinkingLabel?: string;
  reasoningLabel?: string;
}

// Usage:
// <ThinkingBlock content="reasoning text..." isStreaming={false} isCollapsed={false} onToggleCollapse={toggle} />
// <ThinkingBlock content="partial..." isStreaming={true} isCollapsed={false} onToggleCollapse={noop} />
// <ThinkingBlock content="..." thinkingLabel="Pensando..." reasoningLabel="Razonamiento" ... />

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  isStreaming,
  isCollapsed,
  onToggleCollapse,
  thinkingLabel = "Thinking...",
  reasoningLabel,
}) => {
  // A collapsed row that only ever says "Reasoning" carries no information.
  // Lead with what the agent was actually working out.
  const headline = isStreaming ? null : deriveReasoningHeadline(content);
  const label = isStreaming
    ? thinkingLabel
    : (headline ?? reasoningLabel ?? thinkingLabel);

  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse} className="min-w-0 max-w-full overflow-hidden">
      {/* Header (clickable trigger) — flat, no box */}
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-[28px] w-full max-w-full min-w-0 cursor-pointer items-center gap-2 py-0.5 text-left"
        >
          <Brain
            className={cn(
              "size-4 shrink-0 text-muted-foreground/70",
              isStreaming &&
                "animate-pulse motion-reduce:animate-none text-primary/70",
            )}
          />
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              headline ? "font-normal" : "font-medium italic",
              isStreaming
                ? "shimmer-text"
                : "text-muted-foreground/70",
            )}
          >
            {label}
          </span>
          {isCollapsed ? (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
          ) : (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground/50" />
          )}
        </button>
      </CollapsibleTrigger>

      {/* Collapsible content */}
      <CollapsibleContent>
        <div className="mt-2 max-h-[300px] overflow-y-auto overflow-x-hidden transition-all duration-200">
          {content && (
            <MarkdownPreview
              content={content}
              size="sm"
              className="!text-muted-foreground/70 text-sm italic"
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
