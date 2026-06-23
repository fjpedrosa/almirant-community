"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kanban } from "lucide-react";
import type { ProjectBoardsTabProps } from "../../domain/types";

export const ProjectBoardsTab: React.FC<ProjectBoardsTabProps> = ({
  boards,
}) => {
  const t = useTranslations("projects.boardsTab");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("title")}</h3>
      </div>
      {boards.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <Link key={board.id} href={`/board/${board.area}`} prefetch={true} className="block">
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Kanban className="h-4 w-4" />
                    {board.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-2">
                    {board.totalItems} {t("items")}
                  </p>
                  <div className="flex gap-1">
                    {board.columns?.slice(0, 5).map((col) => (
                      <div
                        key={col.id}
                        className="h-2 flex-1 rounded-full"
                        style={{ backgroundColor: col.color }}
                        title={col.name}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-center py-8">
          {t("noBoards")}
        </p>
      )}
    </div>
  );
};
