"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const ConflictDialog = ({
  open,
  localTitle,
  labels,
  onReload,
  onCreateCopy,
  pending,
  error,
}: {
  open: boolean;
  localTitle: string;
  labels: { title: string; description: string; reload: string; createCopy: string; localDraft: string; retryError?: string };
  onReload: () => void;
  onCreateCopy: () => void;
  pending?: "reload" | "copy" | null;
  error?: string | null;
}) => (
  <Dialog open={open}>
    <DialogContent data-notes-surface showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle>{labels.title}</DialogTitle>
        <DialogDescription>{labels.description}</DialogDescription>
      </DialogHeader>
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.localDraft}</p>
        <p className="mt-1 break-words text-sm">{localTitle}</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending !== null && pending !== undefined} onClick={onReload}>{labels.reload}</Button>
        <Button type="button" disabled={pending !== null && pending !== undefined} onClick={onCreateCopy}>{labels.createCopy}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
