"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/hooks";

/**
 * @deprecated Use the CSS utility class `touch-visible` from globals.css instead.
 * This component uses JavaScript-based mobile detection (breakpoint width),
 * while `touch-visible` uses CSS media queries for hover capability detection,
 * which is more accurate for distinguishing touch vs non-touch devices.
 *
 * Migration:
 * ```tsx
 * // Before (with TouchActions)
 * <div className="group">
 *   <TouchActions>
 *     <Button>Action</Button>
 *   </TouchActions>
 * </div>
 *
 * // After (with touch-visible)
 * <div className="group">
 *   <div className="touch-visible flex items-center gap-0.5">
 *     <Button>Action</Button>
 *   </div>
 * </div>
 * ```
 *
 * TouchActions - A wrapper component for action buttons that provides
 * touch-friendly visibility patterns.
 *
 * On mobile devices (< 768px): Actions are always visible
 * On desktop: Actions are hidden by default and shown on hover/focus
 *
 * @example
 * ```tsx
 * <div className="group"> {/* Parent must have 'group' class *\/}
 *   <TouchActions>
 *     <Button variant="ghost" size="icon" onClick={handleEdit}>
 *       <EditIcon />
 *     </Button>
 *     <Button variant="ghost" size="icon" onClick={handleDelete}>
 *       <TrashIcon />
 *     </Button>
 *   </TouchActions>
 * </div>
 * ```
 *
 * IMPORTANT: The parent element must have the `group` class for the hover
 * behavior to work on desktop.
 */
export interface TouchActionsProps {
  /** Action buttons or elements to wrap */
  children: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Whether to stop click propagation (default: true) */
  stopClickPropagation?: boolean;
}

export const TouchActions: React.FC<TouchActionsProps> = ({
  children,
  className,
  stopClickPropagation = true,
}) => {
  const isMobile = useIsMobile();

  const handleClick = (e: React.MouseEvent) => {
    if (stopClickPropagation) {
      e.stopPropagation();
    }
  };

  // On mobile: actions are always visible with pointer events
  // On desktop: actions are hidden by default, shown on group hover/focus
  const containerClassName = isMobile
    ? "flex items-center gap-0.5"
    : cn(
        "flex items-center gap-0.5",
        "opacity-0 pointer-events-none transition-opacity duration-150",
        "group-hover:opacity-100 group-hover:pointer-events-auto",
        "group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
      );

  return (
    <div className={cn(containerClassName, className)} onClick={handleClick}>
      {children}
    </div>
  );
};
