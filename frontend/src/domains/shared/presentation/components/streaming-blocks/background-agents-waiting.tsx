import { useEffect, useState, useRef } from "react";
import { Bot, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToolNameColor } from "./tool-icon";

export interface BackgroundAgentDetail {
  subagentId: string;
  description: string;
  subagentType?: string;
  status: "running" | "done";
}

interface BackgroundAgentsWaitingProps {
  count?: number;
  agents?: BackgroundAgentDetail[];
}

export const BackgroundAgentsWaiting: React.FC<BackgroundAgentsWaitingProps> = ({
  count,
  agents,
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr =
    minutes > 0
      ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
      : `${seconds}s`;

  const hasAgentDetails = agents && agents.length > 0;
  const displayCount = count ?? agents?.length;

  return (
    <div className="mx-4 my-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            {typeof displayCount === "number" && displayCount > 0
              ? `Waiting for ${displayCount} background agent${displayCount > 1 ? "s" : ""} to complete`
              : "Waiting for background agents to complete"}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            Elapsed: {timeStr}
          </span>
        </div>
        {hasAgentDetails && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-primary/10 transition-colors"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse agent details" : "Expand agent details"}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        )}
      </div>

      {hasAgentDetails && isExpanded && (
        <div className="mt-3 max-h-40 overflow-y-auto border-t border-primary/10 pt-3">
          <div className="space-y-1.5">
            {agents.map((agent) => (
              <BackgroundAgentCard key={agent.subagentId} agent={agent} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface BackgroundAgentCardProps {
  agent: BackgroundAgentDetail;
}

const BackgroundAgentCard: React.FC<BackgroundAgentCardProps> = ({ agent }) => {
  const typeLabel = agent.subagentType
    ? agent.subagentType.charAt(0).toUpperCase() + agent.subagentType.slice(1)
    : undefined;
  const label = agent.description || typeLabel || "Agent";
  const nameColor = getToolNameColor(agent.subagentId || agent.subagentType || "agent");
  const isRunning = agent.status === "running";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md bg-background/50 px-2 py-1.5",
        isRunning && "animate-pulse motion-reduce:animate-none"
      )}
    >
      <Bot
        className={cn(
          "h-3.5 w-3.5 flex-shrink-0",
          nameColor
        )}
      />
      {typeLabel && (
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wide whitespace-nowrap",
            nameColor
          )}
        >
          {typeLabel}
        </span>
      )}
      <span className="text-xs text-muted-foreground truncate flex-1">
        {label}
      </span>
      {isRunning && (
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
      )}
    </div>
  );
};
