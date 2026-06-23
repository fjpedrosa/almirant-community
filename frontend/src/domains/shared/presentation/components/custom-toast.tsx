import { toast } from "sonner";
import {
  CircleCheck,
  GitMerge,
  Info,
  OctagonX,
  Circle,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MERGED_TOAST_DARK_CLASSNAMES } from "../utils/toast-theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "neutral"
  | "merged";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface CustomToastProps {
  /** Toast variant determining icon and color scheme */
  type: ToastType;
  /** Primary toast message */
  title: string;
  /** Optional secondary description */
  description?: string;
  /** Optional CTA button */
  action?: ToastAction;
  /** Toast ID for dismissal - provided by sonner's toast.custom() */
  toastId: string | number;
}

// ---------------------------------------------------------------------------
// Icon Configuration
// ---------------------------------------------------------------------------

const TOAST_ICONS: Record<ToastType, React.FC<{ className?: string }>> = {
  success: CircleCheck,
  error: OctagonX,
  warning: TriangleAlert,
  info: Info,
  neutral: Circle,
  merged: GitMerge,
};

// ---------------------------------------------------------------------------
// Color Configuration (dark-mode optimized, subtle palette)
// ---------------------------------------------------------------------------

const TOAST_STYLES: Record<
  ToastType,
  {
    container: string;
    icon: string;
    title: string;
    description: string;
    actionButton: string;
    closeButton: string;
  }
> = {
  success: {
    container:
      "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-700/40",
    icon: "text-emerald-600 dark:text-emerald-400",
    title: "text-emerald-900 dark:text-emerald-200",
    description: "text-emerald-700 dark:text-emerald-300/80",
    actionButton:
      "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800",
    closeButton:
      "bg-emerald-200/80 dark:bg-emerald-800 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-300 dark:hover:bg-emerald-700",
  },
  error: {
    container:
      "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-700/40",
    icon: "text-red-600 dark:text-red-400",
    title: "text-red-900 dark:text-red-200",
    description: "text-red-700 dark:text-red-300/80",
    actionButton:
      "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800",
    closeButton:
      "bg-red-200/80 dark:bg-red-800 text-red-600 dark:text-red-300 hover:bg-red-300 dark:hover:bg-red-700",
  },
  warning: {
    container:
      "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-700/40",
    icon: "text-amber-600 dark:text-amber-400",
    title: "text-amber-900 dark:text-amber-200",
    description: "text-amber-700 dark:text-amber-300/80",
    actionButton:
      "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800",
    closeButton:
      "bg-amber-200/80 dark:bg-amber-800 text-amber-600 dark:text-amber-300 hover:bg-amber-300 dark:hover:bg-amber-700",
  },
  info: {
    container:
      "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-700/40",
    icon: "text-blue-600 dark:text-blue-400",
    title: "text-blue-900 dark:text-blue-200",
    description: "text-blue-700 dark:text-blue-300/80",
    actionButton:
      "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800",
    closeButton:
      "bg-blue-200/80 dark:bg-blue-800 text-blue-600 dark:text-blue-300 hover:bg-blue-300 dark:hover:bg-blue-700",
  },
  neutral: {
    container:
      "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700/40",
    icon: "text-slate-600 dark:text-slate-400",
    title: "text-slate-900 dark:text-slate-200",
    description: "text-slate-700 dark:text-slate-300/80",
    actionButton:
      "bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800",
    closeButton:
      "bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700",
  },
  merged: {
    container:
      `bg-violet-50 border-violet-200 ${MERGED_TOAST_DARK_CLASSNAMES.surface}`,
    icon: `text-violet-600 ${MERGED_TOAST_DARK_CLASSNAMES.icon}`,
    title: `text-violet-900 ${MERGED_TOAST_DARK_CLASSNAMES.title}`,
    description: `text-violet-700 ${MERGED_TOAST_DARK_CLASSNAMES.description}`,
    actionButton:
      `bg-violet-100 text-violet-700 hover:bg-violet-200 ${MERGED_TOAST_DARK_CLASSNAMES.actionButton}`,
    closeButton:
      `bg-violet-200/80 text-violet-600 hover:bg-violet-300 ${MERGED_TOAST_DARK_CLASSNAMES.closeButton}`,
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Custom toast component with 2-column layout: icon (left) + content (right).
 *
 * This is a purely presentational component designed to be used with
 * sonner's `toast.custom()` API. Use the `showToast` utility for easier usage.
 *
 * @example
 * // Direct usage (prefer showToast utility instead)
 * toast.custom((id) => (
 *   <CustomToast
 *     type="success"
 *     title="Operation completed"
 *     description="Your changes have been saved."
 *     toastId={id}
 *   />
 * ));
 */
export const CustomToast: React.FC<CustomToastProps> = ({
  type,
  title,
  description,
  action,
  toastId,
}) => {
  const Icon = TOAST_ICONS[type];
  const styles = TOAST_STYLES[type];

  const handleDismiss = () => {
    toast.dismiss(toastId);
  };

  const handleActionClick = () => {
    action?.onClick();
    toast.dismiss(toastId);
  };

  return (
    <div
      className={cn(
        "relative flex w-full gap-3 rounded-lg border p-4 shadow-lg",
        styles.container
      )}
      role="alert"
      aria-live="assertive"
    >
      {/* macOS-style close button in the top-left corner */}
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleDismiss();
        }}
        className={cn(
          "absolute -left-1.5 -top-1.5 z-10 flex size-5 items-center justify-center rounded-full shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          styles.closeButton
        )}
        aria-label="Dismiss notification"
      >
        <X className="size-3 pointer-events-none" aria-hidden="true" />
      </button>

      {/* Icon Column */}
      <div className="flex shrink-0 items-start pt-0.5">
        <Icon className={cn("size-5", styles.icon)} aria-hidden="true" />
      </div>

      {/* Content Column */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className={cn("text-sm font-medium leading-tight", styles.title)}>
          {title}
        </p>
        {description && (
          <p className={cn("text-sm leading-snug", styles.description)}>
            {description}
          </p>
        )}
        {action && (
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="xs"
              onClick={handleActionClick}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              className={cn("font-medium", styles.actionButton)}
            >
              {action.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
