"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIsTouchDevice } from "@/domains/shared/application/hooks/use-is-touch-device";
import type { Priority } from "../../domain/types";

const PRIORITY_KEYS: Priority[] = ["low", "medium", "high", "urgent"];

interface PriorityStarRatingProps {
  value: Priority;
  onChange: (value: Priority) => void;
}

// Usage:
// <PriorityStarRating value="medium" onChange={(p) => console.log(p)} />

export const PriorityStarRating: React.FC<PriorityStarRatingProps> = ({
  value,
  onChange,
}) => {
  const tPriorities = useTranslations("priorities");
  const { isTouchDevice } = useIsTouchDevice();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const activeIndex = PRIORITY_KEYS.indexOf(value);
  const displayIndex = hoveredIndex !== null ? hoveredIndex : activeIndex;
  const displayLabel = PRIORITY_KEYS[displayIndex]
    ? tPriorities(PRIORITY_KEYS[displayIndex])
    : "";

  return (
    <div
      className="flex items-center gap-1"
      onMouseLeave={() => !isTouchDevice && setHoveredIndex(null)}
      title={displayLabel}
    >
      {PRIORITY_KEYS.map((priority, index) => {
        const isFilled = index <= displayIndex;

        return (
          <button
            key={priority}
            type="button"
            className="cursor-pointer p-2 transition-colors hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
            onMouseEnter={() => !isTouchDevice && setHoveredIndex(index)}
            onTouchEnd={() => setHoveredIndex(null)}
            onClick={() => onChange(priority)}
            aria-label={tPriorities(priority)}
          >
            <Star
              className={
                isFilled
                  ? "text-amber-400 transition-colors"
                  : "text-muted-foreground/30 transition-colors"
              }
              size={14}
              fill={isFilled ? "currentColor" : "none"}
              strokeWidth={1.5}
            />
          </button>
        );
      })}
    </div>
  );
};
