"use client";

import { useTranslations } from "next-intl";
import { MoreHorizontal, Columns3, Pencil, Trash2, Kanban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardSettingsCardProps } from "../../domain/types";

const areaColors: Record<string, string> = {
  desarrollo: "bg-indigo-100 text-indigo-800",
  ventas: "bg-green-100 text-green-800",
  prospeccion: "bg-amber-100 text-amber-800",
  marketing: "bg-pink-100 text-pink-800",
  general: "bg-cyan-100 text-cyan-800",
};

const areaToKey: Record<string, string> = {
  desarrollo: "development",
  ventas: "sales",
  prospeccion: "prospecting",
  marketing: "marketing",
  general: "general",
};

export const BoardSettingsCard: React.FC<BoardSettingsCardProps> = ({
  board,
  onEdit,
  onDelete,
  onManageColumns,
}) => {
  const t = useTranslations("boards");

  return (
    <Card className="group relative transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Kanban className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold truncate">{board.name}</h3>
                {board.isDefault && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Default
                  </Badge>
                )}
              </div>
              <Badge
                variant="secondary"
                className={`mt-1 text-[10px] font-medium ${areaColors[board.area] ?? ""}`}
              >
                {areaToKey[board.area] ? t(`areas.${areaToKey[board.area]}`) : board.area}
              </Badge>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 touch-visible"
                aria-label="Board actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(board)}>
                <Pencil className="h-4 w-4" />
                {t("settings.editBoard")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onManageColumns(board)}>
                <Columns3 className="h-4 w-4" />
                {t("settings.manageColumns")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(board)}
              >
                <Trash2 className="h-4 w-4" />
                {t("settings.deleteBoard")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
