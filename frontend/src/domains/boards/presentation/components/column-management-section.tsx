"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ColorPicker } from "./color-picker";
import { ColumnRow } from "./column-row";
import type { ColumnManagementSectionProps } from "../../domain/types";

const DEFAULT_COLOR = "#6366f1";

export const ColumnManagementSection: React.FC<ColumnManagementSectionProps> = ({
  columns,
  onAddColumn,
  onUpdateColumn,
  onDeleteColumn,
  isLoading,
}) => {
  const t = useTranslations("boards.columns");
  const tCommon = useTranslations("common");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnColor, setNewColumnColor] = useState(DEFAULT_COLOR);

  const sortedColumns = [...columns].sort((a, b) => a.order - b.order);

  const handleAddColumn = () => {
    const trimmed = newColumnName.trim();
    if (!trimmed) return;
    onAddColumn({ name: trimmed, color: newColumnColor });
    setNewColumnName("");
    setNewColumnColor(DEFAULT_COLOR);
    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("configured", { count: columns.length })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddForm(true)}
          disabled={isLoading || showAddForm}
        >
          <Plus className="h-4 w-4" />
          {t("addColumn")}
        </Button>
      </div>

      <div className="space-y-2">
        {sortedColumns.map((column) => (
          <ColumnRow
            key={column.id}
            column={column}
            onUpdate={(data) => onUpdateColumn(column.id, data)}
            onDelete={() => onDeleteColumn(column.id)}
          />
        ))}

        {sortedColumns.length === 0 && !showAddForm && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t("noColumns")}
            </p>
          </div>
        )}
      </div>

      {showAddForm && (
        <>
          <Separator />
          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">{t("newColumn")}</p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="new-column-name" className="text-xs">
                  {t("nameLabel")}
                </Label>
                <Input
                  id="new-column-name"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  placeholder="e.g. In Progress"
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddColumn();
                    if (e.key === "Escape") {
                      setShowAddForm(false);
                      setNewColumnName("");
                      setNewColumnColor(DEFAULT_COLOR);
                    }
                  }}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("colorLabel")}</Label>
                <ColorPicker
                  value={newColumnColor}
                  onChange={setNewColumnColor}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setNewColumnName("");
                  setNewColumnColor(DEFAULT_COLOR);
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleAddColumn}
                disabled={!newColumnName.trim() || isLoading}
              >
                {isLoading ? t("adding") : tCommon("add")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
