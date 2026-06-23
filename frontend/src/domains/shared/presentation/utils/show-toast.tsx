import { toast, type ExternalToast, type ToastClassnames } from "sonner";
import { Circle, GitMerge } from "lucide-react";
import { type ToastAction, type ToastType } from "../components/custom-toast";
import { MERGED_TOAST_DARK_CLASSNAMES } from "./toast-theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShowToastOptions {
  /** Optional secondary description */
  description?: string;
  /** Optional CTA button */
  action?: ToastAction;
  /** Duration in milliseconds before auto-dismiss */
  duration?: number;
  /** Custom toast ID for programmatic control */
  id?: string;
}

// ---------------------------------------------------------------------------
// Default Durations
// ---------------------------------------------------------------------------

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  info: 5000,
  warning: 5000,
  error: 5000,
  neutral: 5000,
  merged: 5000,
};

const TOAST_CREATORS: Record<
  ToastType,
  (title: string, data?: ExternalToast) => string | number
> = {
  success: toast.success,
  error: toast.error,
  warning: toast.warning,
  info: toast.info,
  neutral: toast,
  merged: toast,
};

const TOAST_ICONS: Partial<Record<ToastType, ExternalToast["icon"]>> = {
  neutral: (
    <Circle
      className="size-4 text-slate-700 dark:text-slate-300"
      aria-hidden="true"
    />
  ),
  merged: (
    <GitMerge
      className="size-4 text-violet-700 dark:text-violet-300"
      aria-hidden="true"
    />
  ),
};

// ---------------------------------------------------------------------------
// Internal Helper
// ---------------------------------------------------------------------------

const TOAST_CLASSNAMES: Record<ToastType, ToastClassnames> = {
  success: {
    toast:
      "overflow-visible rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-lg dark:border-emerald-700/40 dark:bg-emerald-950",
    title: "pr-6 text-sm font-medium leading-tight text-emerald-900 dark:text-emerald-200",
    description: "pr-6 text-sm leading-snug text-emerald-700 dark:text-emerald-300/80",
    actionButton:
      "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-800",
    closeButton:
      "bg-emerald-200/80 text-emerald-600 hover:bg-emerald-300 dark:bg-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-700",
  },
  error: {
    toast:
      "overflow-visible rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg dark:border-red-700/40 dark:bg-red-950",
    title: "pr-6 text-sm font-medium leading-tight text-red-900 dark:text-red-200",
    description: "pr-6 text-sm leading-snug text-red-700 dark:text-red-300/80",
    actionButton:
      "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800",
    closeButton:
      "bg-red-200/80 text-red-600 hover:bg-red-300 dark:bg-red-800 dark:text-red-300 dark:hover:bg-red-700",
  },
  warning: {
    toast:
      "overflow-visible rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-lg dark:border-amber-700/40 dark:bg-amber-950",
    title: "pr-6 text-sm font-medium leading-tight text-amber-900 dark:text-amber-200",
    description: "pr-6 text-sm leading-snug text-amber-700 dark:text-amber-300/80",
    actionButton:
      "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300 dark:hover:bg-amber-800",
    closeButton:
      "bg-amber-200/80 text-amber-600 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-300 dark:hover:bg-amber-700",
  },
  info: {
    toast:
      "overflow-visible rounded-lg border border-blue-200 bg-blue-50 p-4 shadow-lg dark:border-blue-700/40 dark:bg-blue-950",
    title: "pr-6 text-sm font-medium leading-tight text-blue-900 dark:text-blue-200",
    description: "pr-6 text-sm leading-snug text-blue-700 dark:text-blue-300/80",
    actionButton:
      "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800",
    closeButton:
      "bg-blue-200/80 text-blue-600 hover:bg-blue-300 dark:bg-blue-800 dark:text-blue-300 dark:hover:bg-blue-700",
  },
  neutral: {
    toast:
      "overflow-visible rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-lg dark:border-slate-700/40 dark:bg-slate-950",
    title: "pr-6 text-sm font-medium leading-tight text-slate-900 dark:text-slate-200",
    description: "pr-6 text-sm leading-snug text-slate-700 dark:text-slate-300/80",
    actionButton:
      "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
    closeButton:
      "bg-slate-200/80 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
    icon: "text-slate-700 dark:text-slate-300",
  },
  merged: {
    toast:
      `overflow-visible rounded-lg border border-violet-200 bg-violet-50 p-4 shadow-lg ${MERGED_TOAST_DARK_CLASSNAMES.surface}`,
    title: `pr-6 text-sm font-medium leading-tight text-violet-900 ${MERGED_TOAST_DARK_CLASSNAMES.title}`,
    description: `pr-6 text-sm leading-snug text-violet-700 ${MERGED_TOAST_DARK_CLASSNAMES.description}`,
    actionButton:
      `bg-violet-100 text-violet-700 hover:bg-violet-200 ${MERGED_TOAST_DARK_CLASSNAMES.actionButton}`,
    closeButton:
      `bg-violet-200/80 text-violet-600 hover:bg-violet-300 ${MERGED_TOAST_DARK_CLASSNAMES.closeButton}`,
    icon: `text-violet-700 ${MERGED_TOAST_DARK_CLASSNAMES.icon}`,
  },
};

const createToast = (
  type: ToastType,
  title: string,
  options?: ShowToastOptions
): string | number => {
  const { description, action, duration, id } = options ?? {};

  const toastOptions: ExternalToast = {
    id,
    closeButton: true,
    duration: duration ?? DEFAULT_DURATIONS[type],
    description,
    classNames: TOAST_CLASSNAMES[type],
    icon: TOAST_ICONS[type],
    action: action
      ? {
          label: action.label,
          onClick: (event) => {
            action.onClick();
            if (createdToastId != null) {
              toast.dismiss(createdToastId);
            }
            event.preventDefault();
          },
        }
      : undefined,
  };

  const createdToastId = TOAST_CREATORS[type](title, toastOptions);

  return createdToastId;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Utility for showing styled Sonner toasts with the native close button.
 *
 * @example
 * // Basic usage
 * showToast.success("Changes saved");
 * showToast.error("Failed to save changes");
 * showToast.warning("Session expiring soon");
 * showToast.info("New features available");
 *
 * @example
 * // With description
 * showToast.success("Lead created", {
 *   description: "The lead has been added to your pipeline.",
 * });
 *
 * @example
 * // With CTA action
 * showToast.info("New update available", {
 *   description: "A new version is ready to install.",
 *   action: {
 *     label: "Update now",
 *     onClick: () => window.location.reload(),
 *   },
 * });
 *
 * @example
 * // With custom duration and ID
 * showToast.error("Connection lost", {
 *   description: "Attempting to reconnect...",
 *   duration: 10000,
 *   id: "connection-error",
 * });
 *
 * @example
 * // Programmatic dismiss
 * const toastId = showToast.info("Processing...", { duration: Infinity });
 * // Later...
 * toast.dismiss(toastId);
 */
export const showToast = {
  /**
   * Show a success toast (green theme, 4s default duration).
   */
  success: (title: string, options?: ShowToastOptions): string | number =>
    createToast("success", title, options),

  /**
   * Show an error toast (red theme, 6s default duration).
   */
  error: (title: string, options?: ShowToastOptions): string | number =>
    createToast("error", title, options),

  /**
   * Show a warning toast (amber theme, 6s default duration).
   */
  warning: (title: string, options?: ShowToastOptions): string | number =>
    createToast("warning", title, options),

  /**
   * Show an info toast (blue theme, 4s default duration).
   */
  info: (title: string, options?: ShowToastOptions): string | number =>
    createToast("info", title, options),

  /**
   * Show a neutral toast (slate theme, 4s default duration).
   */
  neutral: (title: string, options?: ShowToastOptions): string | number =>
    createToast("neutral", title, options),

  /**
   * Show a merged toast (violet theme, 4s default duration).
   */
  merged: (title: string, options?: ShowToastOptions): string | number =>
    createToast("merged", title, options),

  /**
   * Dismiss a toast by ID, or all toasts if no ID is provided.
   */
  dismiss: (toastId?: string | number) => toast.dismiss(toastId),
};

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { ToastAction, ToastType } from "../components/custom-toast";
