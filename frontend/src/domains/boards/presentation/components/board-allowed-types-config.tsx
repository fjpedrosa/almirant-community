"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { BoardAllowedTypesConfigProps, BoardAllowedWorkItemType } from "../../domain/types";

const ALL_WORK_ITEM_TYPES: BoardAllowedWorkItemType[] = [
  "epic",
  "feature",
  "idea",
  "story",
  "task",
];

const typeBadgeColors: Record<BoardAllowedWorkItemType, string> = {
  epic: "bg-purple-600 text-white border-purple-600",
  feature: "bg-blue-600 text-white border-blue-600",
  story: "bg-green-600 text-white border-green-600",
  task: "bg-slate-600 text-white border-slate-600",
  idea: "bg-amber-500 text-white border-amber-500",
};

export const BoardAllowedTypesConfig: React.FC<BoardAllowedTypesConfigProps> = ({
  allowedTypes,
  onChange,
}) => {
  const t = useTranslations("boards");
  const tTypes = useTranslations("workItemTypes");

  const selectedTypes = Array.isArray(allowedTypes) && allowedTypes.length > 0
    ? allowedTypes
    : [];
  const allSelected = selectedTypes.length === 0;

  const handleToggle = (type: BoardAllowedWorkItemType, checked: boolean) => {
    if (checked) {
      const next = [...selectedTypes, type];
      const allChecked = next.length === ALL_WORK_ITEM_TYPES.length;
      onChange(allChecked ? [] : next);
    } else {
      onChange(selectedTypes.filter((t) => t !== type));
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div>
        <Label className="text-sm font-medium">
          {t("form.allowedTypes")}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("form.allowedTypesDesc")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {ALL_WORK_ITEM_TYPES.map((type) => {
          const isChecked = allSelected || selectedTypes.includes(type);
          return (
            <label
              key={type}
              htmlFor={`allowed-type-${type}`}
              className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <Checkbox
                id={`allowed-type-${type}`}
                checked={isChecked}
                onCheckedChange={(checked) =>
                  handleToggle(type, checked === true)
                }
              />
              <Badge
                variant="outline"
                className={`text-[10px] pointer-events-none ${typeBadgeColors[type]}`}
              >
                {tTypes(type)}
              </Badge>
            </label>
          );
        })}
      </div>

      {allSelected && (
        <p className="text-xs text-muted-foreground italic">
          {t("form.allTypesAllowed")}
        </p>
      )}
    </div>
  );
};
