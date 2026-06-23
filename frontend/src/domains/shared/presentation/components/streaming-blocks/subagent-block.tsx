import { Bot, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { getToolNameColor } from "./tool-icon";

interface SubagentBlockProps {
  subagentId: string;
  description: string;
  isBackground: boolean;
  status: "running" | "done";
  subagentType?: string;
  lastActivity?: string;
}

export const SubagentBlock: React.FC<SubagentBlockProps> = ({
  subagentId,
  description,
  isBackground,
  status,
  subagentType,
  lastActivity,
}) => {
  const typeLabel = subagentType
    ? subagentType.charAt(0).toUpperCase() + subagentType.slice(1)
    : undefined;
  // Use description as the primary label; fall back to type or "Agente"
  const label = description || typeLabel || "Agente";
  const nameColor = getToolNameColor(subagentId || typeLabel || "agent");
  const isRunning = status === "running";

  return (
    <div className="py-0.5 px-1">
      <div className={cn("flex items-center gap-2 text-base")}>
        <span className="text-muted-foreground/30 select-none font-mono">
          {"\u251C\u2500\u2500"}
        </span>
        <Bot
          className={cn(
            "size-4 flex-shrink-0",
            isRunning ? nameColor : "text-green-500",
          )}
        />
        {typeLabel && (
          <span className={cn("text-[10px] font-medium uppercase tracking-wide whitespace-nowrap", isRunning ? nameColor : "text-green-500", isRunning && "animate-agent-color-shift motion-reduce:animate-none")}>
            {typeLabel}
          </span>
        )}
        <span className={cn("text-sm truncate", isRunning ? "text-muted-foreground" : "text-muted-foreground/60")}>
          {label}
        </span>
        {isBackground && (
          <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            bg
          </span>
        )}
        {!isRunning && <Check className="size-3.5 text-green-500" />}
      </div>
      {isRunning && lastActivity && (
        <p className="pl-[52px] text-xs text-muted-foreground truncate">
          {lastActivity}
        </p>
      )}
    </div>
  );
};
