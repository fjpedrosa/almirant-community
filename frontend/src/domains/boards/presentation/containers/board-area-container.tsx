"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { History } from "lucide-react";
import { useBoardAreaPage } from "../../application/hooks/use-board-area-page";
import { DynamicWorkItemBoard } from "@/components/dynamic-work-item-board";
import { SprintHistoryContainer } from "@/domains/sprints/presentation/containers/sprint-history-container";
import type { BoardAreaContainerProps } from "../../domain/types";

const areaToKey: Record<string, string> = {
  desarrollo: "development",
  ventas: "sales",
  prospeccion: "prospecting",
  marketing: "marketing",
  general: "general",
};

export const BoardAreaContainer: React.FC<BoardAreaContainerProps> = ({
  area,
}) => {
  const t = useTranslations("boards");
  const {
    boards,
    boardsLoading,
    activeBoardId,
    activeBoard,
  } = useBoardAreaPage(area);
  const [sprintPanelOpen, setSprintPanelOpen] = useState(false);

  if (boardsLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="max-w-[1200px] mx-auto w-full">
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="flex gap-4 mx-auto w-fit min-w-full">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="w-[300px] h-[500px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header — constrained to common app max-width */}
      <div className="flex items-center justify-between max-w-[1200px] mx-auto w-full">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">{areaToKey[area] ? t(`areas.${areaToKey[area]}`) : area}</h1>
        </div>
        {activeBoardId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSprintPanelOpen(true)}
          >
            <History className="h-4 w-4 mr-1.5" />
            Sprints
          </Button>
        )}
      </div>

      {boards.length === 0 ? (
        <div className="text-center py-12 max-w-[1200px] mx-auto w-full">
          <p className="text-muted-foreground">{t("noBoards")}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {t("createBoardHint", { area: areaToKey[area] ? t(`areas.${areaToKey[area]}`) : area })}
          </p>
        </div>
      ) : (
        <DynamicWorkItemBoard
          activeBoardId={activeBoardId}
          activeBoard={activeBoard}
          area={area}
        />
      )}

      {activeBoardId && (
        <SprintHistoryContainer
          boardId={activeBoardId}
          open={sprintPanelOpen}
          onOpenChange={setSprintPanelOpen}
          area={area}
        />
      )}
    </div>
  );
};
