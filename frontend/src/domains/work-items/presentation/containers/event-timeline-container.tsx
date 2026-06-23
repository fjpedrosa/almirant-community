"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useWorkItemEvents } from "../../application/hooks/use-work-item-events";
import { EventTimeline } from "../components/event-timeline";
import { useTranslations } from "next-intl";

interface EventTimelineContainerProps {
  workItemId: string | null;
}

export const EventTimelineContainer: React.FC<EventTimelineContainerProps> = ({
  workItemId,
}) => {
  const t = useTranslations("workItems.timeline");
  const [showAll, setShowAll] = useState(false);
  const { data: allBoards } = useAllBoards();
  const { data: projects = [] } = useProjects();

  const { data: events, isLoading } = useWorkItemEvents(workItemId, {
    limit: showAll ? 200 : 10,
  });

  const columnNameById = (allBoards ?? []).reduce<Record<string, string>>((acc, board) => {
    for (const column of board.columns) {
      acc[column.id] = column.name;
    }
    return acc;
  }, {});

  const projectNameById = projects.reduce<Record<string, string>>((acc, project) => {
    acc[project.id] = project.name;
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      <EventTimeline
        events={events ?? []}
        isLoading={isLoading}
        columnNameById={columnNameById}
        projectNameById={projectNameById}
      />

      {(events?.length ?? 0) > 0 && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowAll((prev) => !prev)}
          >
            {showAll ? t("showLess") : t("showAll")}
          </Button>
        </div>
      )}
    </div>
  );
};
