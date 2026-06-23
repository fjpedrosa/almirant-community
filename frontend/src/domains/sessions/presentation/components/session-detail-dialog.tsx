"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { AgentJobStatusBadge } from "@/domains/agents/presentation/components/agent-job-status-badge";
import type { AgentJobStatus } from "@/domains/agents/domain/types";

interface SessionDetailDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  status: AgentJobStatus | null;
  isLive: boolean;
  children: React.ReactNode;
}

export const SessionDetailDialog: React.FC<SessionDetailDialogProps> = ({
  isOpen,
  onOpenChange,
  title,
  status,
  isLive,
  children,
}) => {
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          className="bg-background fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-slide-down-from-top data-[state=closed]:animate-slide-up-to-top"
        >
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <DialogPrimitive.Title className="truncate text-lg font-semibold">
                {title}
              </DialogPrimitive.Title>
              {status && <AgentJobStatusBadge status={status} />}
              {isLive && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  Live
                </span>
              )}
            </div>
            <DialogPrimitive.Close className="ring-offset-background focus:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden">
              <XIcon className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
