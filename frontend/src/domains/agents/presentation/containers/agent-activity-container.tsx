"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAgentJobMap } from "../../application/hooks/use-agent-job-map";
import { usePendingQuestionsCount } from "../../application/hooks/use-pending-questions";
import { useActiveAiJobsPanel } from "../../application/hooks/use-active-ai-jobs-panel";
import { AgentActivityWidget } from "../components/agent-activity-widget";
import { ActiveAiJobsPanel } from "../components/active-ai-jobs-panel";

interface AgentActivityContainerProps {
  boardId: string;
  workItemTitles?: Map<string, string>;
}

const EMPTY_TITLES = new Map<string, string>();

export const AgentActivityContainer: React.FC<AgentActivityContainerProps> = ({
  boardId,
  workItemTitles = EMPTY_TITLES,
}) => {
  const { summary, allJobs } = useAgentJobMap(boardId);
  const { data: pendingQuestions } = usePendingQuestionsCount();
  const pendingCount = pendingQuestions ?? 0;

  const { activeJobs, currentTime, isCancelling, handleCancelJob } =
    useActiveAiJobsPanel(allJobs, workItemTitles, "Unknown work item");

  // Don't render Popover if the widget would be hidden (no activity)
  const isVisible = summary.running > 0 || summary.queued > 0 || pendingCount > 0;
  if (!isVisible) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <AgentActivityWidget
          summary={summary}
          pendingQuestions={pendingCount}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <ActiveAiJobsPanel
          jobs={activeJobs}
          onCancelJob={handleCancelJob}
          isCancelling={isCancelling}
          currentTime={currentTime}
        />
      </PopoverContent>
    </Popover>
  );
};
