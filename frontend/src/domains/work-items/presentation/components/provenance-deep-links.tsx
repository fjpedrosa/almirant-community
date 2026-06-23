import { Play, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProvenanceLinks } from "../../domain/types";

interface ProvenanceDeepLinksProps {
  links: ProvenanceLinks | null;
  onViewJob?: (jobId: string) => void;
  onViewSession?: (sessionId: string) => void;
}

export function ProvenanceDeepLinks({
  links,
  onViewJob,
  onViewSession,
}: ProvenanceDeepLinksProps) {
  if (!links) return null;

  const hasAnyLink = links.activeJobId || links.latestSessionId;
  if (!hasAnyLink) return null;

  return (
    <div className="flex gap-1.5">
      {links.activeJobId && onViewJob && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1"
              onClick={() => onViewJob(links.activeJobId!)}
            >
              <Play className="size-3" />
              View run
            </Button>
          </TooltipTrigger>
          <TooltipContent>View active agent run details</TooltipContent>
        </Tooltip>
      )}
      {links.latestSessionId && onViewSession && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1"
              onClick={() => onViewSession(links.latestSessionId!)}
            >
              <MessageSquare className="size-3" />
              View session
            </Button>
          </TooltipTrigger>
          <TooltipContent>View AI session output</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
