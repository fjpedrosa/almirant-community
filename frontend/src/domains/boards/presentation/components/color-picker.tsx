"use client";

import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ColorPickerProps } from "../../domain/types";

const PRESET_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#22c55e",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#64748b",
  "#0ea5e9",
  "#14b8a6",
  "#a855f7",
];

export const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange }) => {
  const t = useTranslations("boards.columns");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input shadow-xs transition-colors hover:bg-accent"
          aria-label="Pick a color"
        >
          <span
            className="block h-4 w-4 rounded-full"
            style={{ backgroundColor: value }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="start">
        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground">
            {t("presetColors")}
          </Label>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`h-7 w-7 rounded-md border-2 transition-all hover:scale-110 ${
                  value === color
                    ? "border-foreground ring-1 ring-foreground/20"
                    : "border-transparent"
                }`}
                style={{ backgroundColor: color }}
                onClick={() => onChange(color)}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hex-input" className="text-xs font-medium text-muted-foreground">
              {t("hexValue")}
            </Label>
            <Input
              id="hex-input"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="#000000"
              className="h-8 text-sm"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
