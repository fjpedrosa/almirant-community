import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

export function InfoTooltip({ content, side = "top", className }: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex cursor-help rounded-full p-0.5 hover:bg-muted",
            className,
          )}
        >
          <Info className="size-3.5 text-muted-foreground transition-colors hover:text-foreground" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs">
        <p className="text-xs">{content}</p>
      </TooltipContent>
    </Tooltip>
  );
}
