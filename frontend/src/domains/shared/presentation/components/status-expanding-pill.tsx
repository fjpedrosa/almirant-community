"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsTouchDevice } from "@/domains/shared/application/hooks/use-is-touch-device";
import { cn } from "@/lib/utils";

export interface StatusOption {
  value: string;
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
}

export interface StatusExpandingPillProps {
  currentStatus: string;
  statuses: StatusOption[];
  onStatusChange: (status: string) => void;
  isLoading?: boolean;
}

export const StatusExpandingPill: React.FC<StatusExpandingPillProps> = ({
  currentStatus,
  statuses,
  onStatusChange,
  isLoading = false,
}) => {
  const { isTouchDevice } = useIsTouchDevice();
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside handler to collapse on touch devices
  useEffect(() => {
    if (!isTouchDevice || !isExpanded) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isTouchDevice, isExpanded]);

  const current = statuses.find((s) => s.value === currentStatus);
  if (!current) return null;

  const others = statuses.filter((s) => s.value !== currentStatus);
  const showOptions = isExpanded;
  const CurrentIcon = current.icon;

  const handlePillClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isTouchDevice) {
      setIsExpanded((prev) => !prev);
    }
  };

  const handleMouseEnter = () => {
    if (!isTouchDevice) {
      setIsExpanded(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isTouchDevice) {
      setIsExpanded(false);
    }
  };

  if (isLoading) {
    return (
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium",
          current.bgColor,
          current.color,
          current.borderColor,
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {current.label}
      </span>
    );
  }

  return (
    <motion.div
      ref={containerRef}
      className={cn(
        "relative inline-flex items-center rounded-full border text-xs font-medium",
        // Increase pill height on touch devices for better tap targets
        isTouchDevice ? "h-8" : "h-6",
        current.bgColor,
        current.color,
        current.borderColor,
        // Add cursor pointer on touch devices to indicate tappability
        isTouchDevice && "cursor-pointer",
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handlePillClick}
      layout
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <span className="flex items-center gap-1 px-2">
        <CurrentIcon className="h-3 w-3 shrink-0" />
        <span className="whitespace-nowrap">{current.label}</span>
      </span>

      <AnimatePresence>
        {showOptions && others.length > 0 && (
          <motion.div
            className="flex items-center gap-0.5 pr-1"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <span className="mx-0.5 h-3 w-px bg-current opacity-20" />
            {others.map((status) => {
              const Icon = status.icon;
              return (
                <Tooltip key={status.value}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center justify-center rounded-full transition-colors",
                        "hover:bg-black/10 active:bg-black/20",
                        // Larger touch targets on touch devices (32px vs 20px)
                        isTouchDevice ? "h-7 w-7" : "h-5 w-5",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onStatusChange(status.value);
                        // Collapse after selection on touch devices
                        if (isTouchDevice) {
                          setIsExpanded(false);
                        }
                      }}
                      aria-label={`Cambiar estado a ${status.label}`}
                    >
                      <Icon
                        className={cn(
                          status.color,
                          isTouchDevice ? "h-4 w-4" : "h-3 w-3",
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {status.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
