"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type MaturityLevelKey = "intuition" | "concept" | "ready";

const MATURITY_STYLE_CONFIG: Record<
  number,
  { labelKey: MaturityLevelKey; color: string; bgColor: string; borderColor: string }
> = {
  1: {
    labelKey: "intuition",
    color: "text-slate-600",
    bgColor: "bg-slate-100",
    borderColor: "border-slate-200",
  },
  2: {
    labelKey: "concept",
    color: "text-amber-600",
    bgColor: "bg-amber-100",
    borderColor: "border-amber-200",
  },
  3: {
    labelKey: "ready",
    color: "text-emerald-600",
    bgColor: "bg-emerald-100",
    borderColor: "border-emerald-200",
  },
};

interface SeedMaturityBadgeProps {
  level: number;
}

export const SeedMaturityBadge: React.FC<SeedMaturityBadgeProps> = ({
  level,
}) => {
  const t = useTranslations("seeds.maturity.levels");
  const config = MATURITY_STYLE_CONFIG[level] ?? MATURITY_STYLE_CONFIG[1];
  const safeLevel = level >= 1 && level <= 3 ? level : 1;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "h-5 px-1.5 text-[10px] font-medium gap-0.5",
            config.color,
            config.bgColor,
            config.borderColor,
          )}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                i < safeLevel
                  ? "bg-current opacity-100"
                  : "bg-current opacity-20",
              )}
            />
          ))}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">{t(config.labelKey)}</TooltipContent>
    </Tooltip>
  );
};
