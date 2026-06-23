"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BoardAllowedTypesConfig } from "./board-allowed-types-config";
import type { EditBoardFormProps, BoardArea, BoardAllowedWorkItemType } from "../../domain/types";

const AREA_KEYS: { value: BoardArea; key: string }[] = [
  { value: "desarrollo", key: "development" },
  { value: "ventas", key: "sales" },
  { value: "prospeccion", key: "prospecting" },
  { value: "marketing", key: "marketing" },
  { value: "general", key: "general" },
];

const arraysEqual = (a: BoardAllowedWorkItemType[] | null, b: BoardAllowedWorkItemType[] | null): boolean => {
  const normA = Array.isArray(a) && a.length > 0 ? [...a].sort() : [];
  const normB = Array.isArray(b) && b.length > 0 ? [...b].sort() : [];
  if (normA.length !== normB.length) return false;
  return normA.every((val, idx) => val === normB[idx]);
};

export const EditBoardForm: React.FC<EditBoardFormProps> = ({
  board,
  onSave,
  isLoading,
}) => {
  const t = useTranslations("boards");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? "");
  const [area, setArea] = useState<BoardArea>(board.area);
  const [isDefault, setIsDefault] = useState(board.isDefault);
  const [allowedTypes, setAllowedTypes] = useState<BoardAllowedWorkItemType[]>(
    Array.isArray(board.allowedTypes) && board.allowedTypes.length > 0
      ? board.allowedTypes
      : []
  );

  const hasChanges =
    name !== board.name ||
    description !== (board.description ?? "") ||
    area !== board.area ||
    isDefault !== board.isDefault ||
    !arraysEqual(allowedTypes.length > 0 ? allowedTypes : null, board.allowedTypes ?? null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      area,
      isDefault,
      allowedTypes: allowedTypes.length > 0 ? allowedTypes : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="board-name">{t("form.name")}</Label>
        <Input
          id="board-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("form.namePlaceholder")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="board-description">{t("form.description")}</Label>
        <Textarea
          id="board-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("form.descriptionOptional")}
          rows={3}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="board-area">{t("form.area")}</Label>
        <Select value={area} onValueChange={(v) => setArea(v as BoardArea)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("form.selectArea")} />
          </SelectTrigger>
          <SelectContent>
            {AREA_KEYS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(`areas.${option.key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label htmlFor="board-default" className="text-sm font-medium">
            {t("form.defaultBoard")}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("form.defaultBoardDesc")}
          </p>
        </div>
        <Switch
          id="board-default"
          checked={isDefault}
          onCheckedChange={(checked) => setIsDefault(checked === true)}
        />
      </div>

      <BoardAllowedTypesConfig
        allowedTypes={allowedTypes.length > 0 ? allowedTypes : null}
        onChange={setAllowedTypes}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={!name.trim() || !hasChanges || isLoading}>
          {isLoading ? tCommon("saving") : tCommon("saveChanges")}
        </Button>
      </div>
    </form>
  );
};
