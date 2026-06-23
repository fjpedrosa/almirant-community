"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { ExternalLink } from "lucide-react";
import type { GithubRepoLinkProps } from "../../domain/types";

export const GithubRepoLink: React.FC<GithubRepoLinkProps> = ({ url }) => {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            asChild
          >
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open repository on GitHub"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Open on GitHub
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
