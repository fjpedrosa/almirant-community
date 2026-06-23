import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse} className="min-w-0 max-w-full overflow-hidden">
      {/* Header (clickable trigger) — flat, no box */}
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 text-left py-0.5 cursor-pointer min-h-[28px]"
        >
          <Brain
            className={cn(
              "size-4 text-muted-foreground/70",
              isStreaming &&
                "animate-pulse motion-reduce:animate-none text-primary/70",
            )}
          />
          <span
            className={cn(
              "text-sm font-medium italic",
              isStreaming
                ? "shimmer-text"
                : "text-muted-foreground/70",
            )}
          >
            {isStreaming ? thinkingLabel : (reasoningLabel ?? thinkingLabel)}
          </span>
          {isCollapsed ? (
            <ChevronRight className="size-4 text-muted-foreground/50" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground/50" />
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
