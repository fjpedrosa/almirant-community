"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { GripVertical, Trash2, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColorPicker } from "./color-picker";
import type { ColumnRowProps } from "../../domain/types";

export const ColumnRow: React.FC<ColumnRowProps> = ({
  column,
  onUpdate,
  onDelete,
  dragHandleProps,
}) => {
  const t = useTranslations("boards.columns");
  const [editingName, setEditingName] = useState(false);
  // Keep a local draft only while editing. When not editing, render the source of truth (column.name).
  const [nameValue, setNameValue] = useState("");

  const handleNameSubmit = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== column.name) {
      onUpdate({ name: trimmed });
    } else {
      setNameValue(column.name);
    }
    setEditingName(false);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-2 group">
      <div
        className="flex shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground"
        {...dragHandleProps}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <span
        className="block h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: column.color }}
        aria-hidden="true"
      />

      {editingName ? (
        <Input
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={handleNameSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleNameSubmit();
            if (e.key === "Escape") {
              setNameValue(column.name);
              setEditingName(false);
            }
          }}
          className="h-7 text-sm flex-1"
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="flex-1 text-left text-sm truncate hover:text-foreground/80 transition-colors"
          onClick={() => {
            setNameValue(column.name);
            setEditingName(true);
          }}
          aria-label={`Edit column name: ${column.name}`}
        >
          {column.name}
        </button>
      )}

      <ColorPicker
        value={column.color}
        onChange={(color) => onUpdate({ color })}
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            <Switch
              id={`done-${column.id}`}
              checked={column.isDone}
              onCheckedChange={(checked) => onUpdate({ isDone: checked === true })}
              aria-label="Mark as done column"
            />
            <Label
              htmlFor={`done-${column.id}`}
              className="sr-only"
            >
              Done column
            </Label>
            {column.isDone && (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{column.isDone ? t("doneColumn") : t("markDone")}</p>
        </TooltipContent>
      </Tooltip>

      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 touch-visible text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        aria-label={`Delete column ${column.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
