"use client";

import { Clock, CheckCircle2, XCircle, MessageCircleQuestion, AlertTriangle, PauseCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { getProviderIcon } from "@/domains/shared/presentation/utils/provider-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentJobIndicatorProps } from "../../domain/types";

export const AgentJobIndicator: React.FC<AgentJobIndicatorProps> = ({ status, provider }) => {
  const t = useTranslations("agents");

  if (status === "cancelled") return null;

  const providerIconClassName = cn(
    "h-3.5 w-3.5",
    status === "queued" && "text-muted-foreground",
    status === "running" && "text-foreground animate-agent-pulse",
    status === "finalizing" && "text-sky-500",
    status === "waiting_for_input" && "text-amber-500 animate-pulse",
    status === "paused" && "text-orange-500",
    (status === "completed" || status === "incomplete" || status === "failed") && "text-muted-foreground"
  );

  const icon = (() => {
    if (status === "queued") return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    if (status === "running") return null;
    if (status === "finalizing") return <Clock className="h-3.5 w-3.5 text-sky-500" />;
    if (status === "waiting_for_input") return <MessageCircleQuestion className="h-3.5 w-3.5 text-amber-500" />;
    if (status === "paused") return <PauseCircle className="h-3.5 w-3.5 text-orange-500" />;
    if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 animate-agent-complete" />;
    if (status === "incomplete") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    return <XCircle className="h-3.5 w-3.5 text-red-600" />;
  })();

  const label = t(`status.${status}`);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1">
          {getProviderIcon(provider, providerIconClassName)}
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
