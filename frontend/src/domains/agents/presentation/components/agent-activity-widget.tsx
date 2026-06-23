"use client";

import { forwardRef } from "react";
import { Bot, Clock3, MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AgentActivityWidgetProps } from "../../domain/types";

export const AgentActivityWidget = forwardRef<
  HTMLButtonElement,
  AgentActivityWidgetProps & React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ summary, pendingQuestions = 0, onClick, className, ...rest }, ref) => {
  const tActivity = useTranslations("agents.activity");

  if (summary.running === 0 && summary.queued === 0 && pendingQuestions === 0) return null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-xs shadow-sm",
        onClick && "cursor-pointer hover:bg-accent transition-colors",
        className
      )}
      {...rest}
    >
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <span className="inline-flex items-center gap-1">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        {tActivity("running", { count: summary.running })}
      </span>
      <span className="text-muted-foreground">/</span>
      <span className="inline-flex items-center gap-1">
        <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
        {tActivity("queued", { count: summary.queued })}
      </span>
      {pendingQuestions > 0 && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="inline-flex items-center gap-1 text-amber-600">
            <MessageCircleQuestion className="h-3.5 w-3.5" />
            {tActivity("waiting", { count: pendingQuestions })}
          </span>
        </>
      )}
    </button>
  );
});

AgentActivityWidget.displayName = "AgentActivityWidget";
