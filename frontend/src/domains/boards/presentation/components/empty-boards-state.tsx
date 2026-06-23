"use client";

import { useTranslations } from "next-intl";
import { Kanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EmptyBoardsStateProps } from "../../domain/types";

export const EmptyBoardsState: React.FC<EmptyBoardsStateProps> = ({
  onCreateBoard,
}) => {
  const t = useTranslations("boards.empty");

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
        <Kanban className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{t("title")}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        {t("description")}
      </p>
      <Button onClick={onCreateBoard}>{t("button")}</Button>
    </div>
  );
};
