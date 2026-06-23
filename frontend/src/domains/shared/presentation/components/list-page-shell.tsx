import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ListPageShellProps {
  /** Page header (title, description, action buttons) */
  header: ReactNode;
  /** Filter bar section — rendered below header, above scrollable content */
  filters?: ReactNode;
  /** Main scrollable content (list items, etc.) */
  children: ReactNode;
  /** Fixed footer (pagination, etc.) — rendered below the scrollable area */
  footer?: ReactNode;
  /** Loading state placeholder — replaces filters + children + footer when true */
  loading?: ReactNode;
  /**
   * ID applied to the scrollable content container.
   * Useful for programmatically resetting scroll position.
   * @default "list-page-shell-content"
   */
  scrollContainerId?: string;
  /**
   * When true (default), the shell wraps everything in `max-w-[1200px] mx-auto`
   * and adds `px-6` + `pt-6` to each inner section.
   * Set to false when the surrounding layout already provides max-width and
   * horizontal/vertical padding — typical for pages inside the backoffice
   * feedback layout, which already handles both.
   * @default true
   */
  contained?: boolean;
}

/**
 * Shared layout shell for list pages (Ideas, Todos, Seeds).
 *
 * Provides a consistent flex-column structure where:
 * - Header and footer are fixed (non-scrolling)
 * - Only the content area scrolls
 * - No double-scrolling with the dashboard layout
 *
 * Purely presentational — no hooks or state.
 */
export function ListPageShell({
  header,
  filters,
  children,
  footer,
  loading,
  scrollContainerId = "list-page-shell-content",
  contained = true,
}: ListPageShellProps) {
  const wrapperCls = contained ? "max-w-[1200px] mx-auto" : "";
  const padX = contained ? "px-4 sm:px-6" : "";
  const padTop = contained ? "pt-4 sm:pt-6" : "";
  const padBottom = contained ? "pb-4 sm:pb-6" : "";
  const filterGap = contained ? "pt-4 sm:pt-6" : "pt-4";
  const contentGap = contained ? "pt-4 sm:pt-6" : "pt-4";

  return (
    <div
      className={cn("flex flex-col h-full min-h-0 w-full", wrapperCls)}
      data-testid="list-page-shell"
    >
      {/* Fixed header */}
      <div className={cn("shrink-0 pb-0", padX, padTop)}>{header}</div>

      {loading ? (
        <div className="flex-1 min-h-0 overflow-hidden">{loading}</div>
      ) : (
        <>
          {/* Fixed filters */}
          {filters && (
            <div className={cn("shrink-0 pb-0", padX, filterGap)}>{filters}</div>
          )}

          {/* Scrollable content area */}
          <div
            id={scrollContainerId}
            data-testid="list-page-shell-content"
            className={cn(
              "flex-1 overflow-auto min-h-0 space-y-6",
              padX,
              contentGap,
              padBottom
            )}
          >
            {children}
          </div>

          {/* Fixed footer */}
          {footer && (
            <div className={cn("shrink-0 border-t py-4", padX)}>{footer}</div>
          )}
        </>
      )}
    </div>
  );
}
