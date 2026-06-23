"use client";

import { Columns3, Kanban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { BoardCardProps } from "../../domain/types";

export const BoardCard: React.FC<BoardCardProps> = ({ board }) => {
  return (
    <Card className="transition-all hover:shadow-md hover:-translate-y-0.5">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Kanban className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold truncate">{board.name}</h3>
            {board.description && (
              <p className="mt-1 text-xs text-muted-foreground truncate">
                {board.description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Columns3 className="h-3 w-3" />
            {board.columns.length} {board.columns.length === 1 ? "column" : "columns"}
          </span>
          <span>{board.totalItems} {board.totalItems === 1 ? "item" : "items"}</span>
        </div>
      </CardContent>
    </Card>
  );
};
