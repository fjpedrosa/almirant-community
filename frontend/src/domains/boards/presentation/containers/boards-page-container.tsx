"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { useAllBoards, useBoardTemplates } from "../../application/hooks/use-boards";
import { useBoardForm } from "../../application/hooks/use-board-form";
import { usePrefetchBoardWorkItems } from "../../application/hooks/use-prefetch-board-work-items";
import { useHasProjects } from "@/domains/projects/application/hooks/use-has-projects";
import { BoardAreaGroup } from "../components/board-area-group";
import { EmptyBoardsState } from "../components/empty-boards-state";
import { CreateBoardDialog } from "../components/create-board-dialog";
import { CreateProjectCta } from "@/domains/shared/presentation/components/create-project-cta";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { BoardArea, BoardWithStats } from "../../domain/types";

const AREA_ORDER: BoardArea[] = ["desarrollo", "ventas", "prospeccion", "marketing", "general"];

const AREA_LABEL_KEYS: Record<BoardArea, string> = {
  desarrollo: "areas.development",
  ventas: "areas.sales",
  prospeccion: "areas.prospecting",
  marketing: "areas.marketing",
  general: "areas.general",
};

const groupBoardsByArea = (boards: BoardWithStats[]): Record<BoardArea, BoardWithStats[]> => {
  const grouped: Record<string, BoardWithStats[]> = {};
  for (const board of boards) {
    const key = board.area;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(board);
  }
  return grouped as Record<BoardArea, BoardWithStats[]>;
};

export const BoardsPageContainer: React.FC = () => {
  const t = useTranslations("boards");
  const tProjects = useTranslations("projects");
  const { data: boards, isLoading } = useAllBoards();
  const { data: templates } = useBoardTemplates();
  const { hasProjects, isLoading: isLoadingProjects } = useHasProjects();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  usePrefetchBoardWorkItems(boards as BoardWithStats[] | undefined);

  const {
    onCreateSubmit,
    onCreateFromTemplate,
    isLoading: isFormLoading,
  } = useBoardForm(() => setCreateDialogOpen(false));

  const boardsByArea = groupBoardsByArea(boards || []);
  const hasBoards = (boards || []).length > 0;

  // Show only areas that have boards, sorted by defined order
  const areaKeys = AREA_ORDER.filter((area) => boardsByArea[area]?.length > 0);

  if (isLoading || isLoadingProjects) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        {hasBoards && (
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("createBoard")}
          </Button>
        )}
      </div>

      {!hasProjects ? (
        <CreateProjectCta
          title={tProjects("noProjects")}
          description={tProjects("noProjectsHint")}
          buttonLabel={tProjects("createProject")}
        />
      ) : !hasBoards ? (
        <EmptyBoardsState onCreateBoard={() => setCreateDialogOpen(true)} />
      ) : (
        <div className="space-y-8">
          {areaKeys.map((area) => (
            <BoardAreaGroup
              key={area}
              areaLabel={t(AREA_LABEL_KEYS[area])}
              boards={boardsByArea[area]}
            />
          ))}
        </div>
      )}

      <CreateBoardDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        templates={templates || []}
        onCreateFromScratch={onCreateSubmit}
        onCreateFromTemplate={(data) =>
          onCreateFromTemplate(data.templateId, data.name)
        }
        isLoading={isFormLoading}
      />
    </div>
  );
};
