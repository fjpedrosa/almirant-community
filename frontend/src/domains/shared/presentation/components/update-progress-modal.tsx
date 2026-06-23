"use client";

import type React from "react";
import { useEffect, useRef } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  CircleAlert,
  Loader2,
  RotateCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  UpdateJob,
  UpdateStep,
} from "../../domain/instance-version-types";

export type ModalView =
  | "hidden"
  | "confirming"
  | "running"
  | "backend-down"
  | "success"
  | "failed";

export interface UpdateProgressModalProps {
  view: ModalView;
  current: string | null;
  latest: string | null;
  job: UpdateJob | null;
  /** When set on view=failed, summarises the failure for the user. */
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onReload: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

const STEPS: { key: UpdateStep; label: string }[] = [
  { key: "fetching", label: "Fetching latest code" },
  { key: "building", label: "Building images" },
  { key: "recreating", label: "Restarting services" },
  { key: "healthchecking", label: "Health-checking" },
];

const stepIndex = (step: UpdateStep | null): number => {
  if (!step) return -1;
  if (step === "done") return STEPS.length;
  return STEPS.findIndex((s) => s.key === step);
};

const StepRow: React.FC<{
  label: string;
  state: "done" | "active" | "pending";
}> = ({ label, state }) => (
  <li className="flex items-center gap-2 text-sm">
    {state === "done" && (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
    )}
    {state === "active" && (
      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
    )}
    {state === "pending" && (
      <span className="h-4 w-4 rounded-full border border-muted-foreground/40" aria-hidden />
    )}
    <span
      className={cn(
        state === "done" && "text-foreground",
        state === "active" && "text-foreground font-medium",
        state === "pending" && "text-muted-foreground",
      )}
    >
      {label}
    </span>
  </li>
);

const StepList: React.FC<{ currentStep: UpdateStep | null }> = ({
  currentStep,
}) => {
  const idx = stepIndex(currentStep);
  return (
    <ol className="flex flex-col gap-2">
      {STEPS.map((step, i) => {
        const state =
          i < idx ? "done" : i === idx ? "active" : "pending";
        return <StepRow key={step.key} label={step.label} state={state} />;
      })}
    </ol>
  );
};

const LogTail: React.FC<{ job: UpdateJob | null }> = ({ job }) => {
  const ref = useRef<HTMLDivElement>(null);
  const tail = job?.logTail.slice(-50) ?? [];

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail.length]);

  if (tail.length === 0) {
    return (
      <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Waiting for log output…
      </div>
    );
  }

  return (
    <ScrollArea className="h-40 rounded border bg-muted/40">
      <div ref={ref} className="px-3 py-2 font-mono text-xs leading-5">
        {tail.map((line, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              line.source === "stderr" && "text-red-500",
              line.source === "system" && "text-primary",
            )}
          >
            {line.text}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};

const ShaPair: React.FC<{ from: string | null; to: string | null }> = ({
  from,
  to,
}) => (
  <span className="font-mono text-xs text-muted-foreground">
    {from ?? "unknown"} → {to ?? "latest"}
  </span>
);

export const UpdateProgressModal: React.FC<UpdateProgressModalProps> = ({
  view,
  current,
  latest,
  job,
  errorMessage,
  onConfirm,
  onCancel,
  onReload,
  onRetry,
  onDismiss,
}) => {
  const open = view !== "hidden";

  // Lock the dialog from closing during running/backend-down — the user
  // shouldn't navigate away mid-rebuild, and there's nothing useful to do
  // until the backend reconnects.
  const closable =
    view === "confirming" || view === "success" || view === "failed";

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (!closable) return;
    if (view === "confirming") onCancel();
    else if (view === "success") onReload();
    else onDismiss();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={closable}>
        {view === "confirming" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowUpCircle className="h-5 w-5 text-primary" aria-hidden />
                Update Almirant?
              </DialogTitle>
              <DialogDescription>
                <span className="block">
                  This rebuilds and restarts the stack (~2–5 min). The page
                  will reload automatically when the new version is online.
                </span>
                <span className="mt-2 block">
                  <ShaPair from={current} to={latest} />
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={onConfirm}>Update now</Button>
            </DialogFooter>
          </>
        )}

        {view === "running" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2
                  className="h-5 w-5 animate-spin text-primary"
                  aria-hidden
                />
                Updating Almirant
              </DialogTitle>
              <DialogDescription>
                <ShaPair from={current} to={job?.toSha ?? latest} />
              </DialogDescription>
            </DialogHeader>
            <StepList currentStep={job?.step ?? null} />
            <LogTail job={job} />
          </>
        )}

        {view === "backend-down" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2
                  className="h-5 w-5 animate-spin text-primary"
                  aria-hidden
                />
                Restarting Almirant
              </DialogTitle>
              <DialogDescription>
                The backend went offline as expected while applying the
                update. Reconnecting — this usually takes 30–90 seconds.
              </DialogDescription>
            </DialogHeader>
          </>
        )}

        {view === "success" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2
                  className="h-5 w-5 text-emerald-500"
                  aria-hidden
                />
                Update complete
              </DialogTitle>
              <DialogDescription>
                Almirant is now running{" "}
                <ShaPair from={current} to={job?.toSha ?? latest} />.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onReload}>
                <RotateCw className="mr-2 h-4 w-4" aria-hidden />
                Reload
              </Button>
            </DialogFooter>
          </>
        )}

        {view === "failed" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleAlert className="h-5 w-5 text-red-500" aria-hidden />
                Update failed
              </DialogTitle>
              <DialogDescription>
                {errorMessage ??
                  "The update did not complete. Check the logs below for details."}
              </DialogDescription>
            </DialogHeader>
            <LogTail job={job} />
            <DialogFooter>
              <Button variant="outline" onClick={onDismiss}>
                Dismiss
              </Button>
              <Button onClick={onRetry}>Retry</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
