"use client";

import dynamic from "next/dynamic";
import { KanbanBoardSkeleton } from "@/components/skeletons";
import type { WorkItemBoardContainerProps } from "@/domains/work-items/domain/types";

const DynamicWorkItemBoard = dynamic<WorkItemBoardContainerProps>(
  () =>
    import(
      "@/domains/work-items/presentation/containers/work-item-board-container"
    ).then((mod) => mod.WorkItemBoardContainer),
  {
    ssr: false,
    loading: () => <KanbanBoardSkeleton />,
  }
);

export { DynamicWorkItemBoard };
