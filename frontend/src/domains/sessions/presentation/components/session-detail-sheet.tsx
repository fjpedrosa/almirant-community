'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { AgentJobStatusBadge } from '@/domains/agents/presentation/components/agent-job-status-badge';
import type { AgentJobStatus } from '@/domains/agents/domain/types';

interface SessionDetailSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  status: AgentJobStatus | null;
  isLive: boolean;
  children: React.ReactNode;
}

const FEEDBACK_OUTSIDE_GUARD_SELECTORS = [
  "[data-feedback-widget-trigger]",
  "[data-feedback-widget-content]",
  "[data-chat-feedback-trigger]",
  "[data-chat-feedback-content]",
  "[data-feedback-category-content]",
] as const;

/**
 * Radix outside events are CustomEvents where the clicked element may not be
 * on `event.target`. Radix >=1.1 stores the underlying DOM event under
 * `event.detail.originalEvent`. We check both locations to resolve the actual
 * target that was interacted with.
 */
const resolveOutsideEventTarget = (event: Event): EventTarget | null => {
  if (event.target instanceof Element) {
    return event.target;
  }
  const detail = (event as CustomEvent<{ originalEvent?: Event }>).detail;
  return detail?.originalEvent?.target ?? null;
};

const isFeedbackTarget = (target: EventTarget | null): target is Element =>
  target instanceof Element &&
  FEEDBACK_OUTSIDE_GUARD_SELECTORS.some((selector) =>
    Boolean(target.closest(selector)),
  );

export const SessionDetailSheet: React.FC<SessionDetailSheetProps> = ({
  isOpen,
  onOpenChange,
  title,
  status,
  isLive,
  children,
}) => {
  const handleFeedbackWidgetOutsideEvent = (event: Event) => {
    const target = resolveOutsideEventTarget(event);
    if (isFeedbackTarget(target)) {
      event.preventDefault();
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlayClassName="z-40"
        onPointerDownOutside={handleFeedbackWidgetOutsideEvent}
        onFocusOutside={handleFeedbackWidgetOutsideEvent}
        onInteractOutside={handleFeedbackWidgetOutsideEvent}
        className="z-40 flex h-dvh w-full max-w-none flex-col overflow-hidden rounded-l-2xl p-0 shadow-2xl sm:w-[94vw] sm:max-w-[94vw] 2xl:w-[1600px] 2xl:max-w-[1600px]"
      >
        <SheetHeader className="flex h-14 shrink-0 flex-row items-center gap-2 border-b pl-10 pr-4 py-0 space-y-0 sm:gap-3 sm:pr-6">
          <SheetTitle className="truncate text-base sm:text-lg">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            Session detail panel
          </SheetDescription>
          {status && <AgentJobStatusBadge status={status} />}
          {isLive && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Live
            </span>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </SheetContent>
    </Sheet>
  );
};
