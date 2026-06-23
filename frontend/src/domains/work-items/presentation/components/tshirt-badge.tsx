import { cn } from "@/lib/utils";
import type { TShirtSize } from "../../domain/types";
import { tshirtSizeColors } from "./work-item-style";

interface TShirtBadgeProps {
  /** The size label to display. */
  size: TShirtSize;
  /** Optional additional CSS classes. */
  className?: string;
}

/**
 * A compact text-only story-points size marker.
 *
 * We intentionally avoid the old t-shirt silhouette here: the board only needs
 * the sizing letter(s), and the tooltip already explains the underlying points.
 */
export const TShirtBadge = ({ size, className }: TShirtBadgeProps) => (
  <span
    role="img"
    aria-label={`Size ${size}`}
    className={cn(
      "inline-flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-[3px] px-0.5 font-mono text-[10px] font-bold leading-none tracking-tight",
      tshirtSizeColors[size],
      className
    )}
  >
    {size}
  </span>
);

TShirtBadge.displayName = "TShirtBadge";
