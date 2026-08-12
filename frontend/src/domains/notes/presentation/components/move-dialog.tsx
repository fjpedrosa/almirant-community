"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { NotePageSummary } from "../../domain/types";

const unavailableDestinationIds = (pages: NotePageSummary[], currentPageId: string): Set<string> => {
  const unavailable = new Set([currentPageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of pages) {
      if (page.parentId && unavailable.has(page.parentId) && !unavailable.has(page.id)) {
        unavailable.add(page.id);
        changed = true;
      }
    }
  }
  return unavailable;
};

export const MoveDialog = ({
  open,
  currentPageId,
  pages,
  labels,
  onMove,
  onOpenChange,
  pending = false,
  error,
}: {
  open: boolean;
  currentPageId: string;
  pages: NotePageSummary[];
  labels: { title: string; description: string; root: string; move: string; cancel: string };
  onMove: (parentId: string | null) => void;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  error?: string | null;
}) => {
  const [parentId, setParentId] = useState("");
  const destinations = useMemo(() => {
    const unavailable = unavailableDestinationIds(pages, currentPageId);
    return pages.filter((page) => page.kind === "page" && page.canEdit && !unavailable.has(page.id));
  }, [currentPageId, pages]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) setParentId(""); onOpenChange(nextOpen); }}>
      <DialogContent data-notes-surface>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="space-y-2">
          <Label htmlFor="notes-move-destination" className="sr-only">{labels.title}</Label>
          <select
            id="notes-move-destination"
            aria-label={labels.title}
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{labels.root}</option>
            {destinations.map((page) => <option key={page.id} value={page.id}>{page.title || labels.root}</option>)}
          </select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
          <Button type="button" disabled={pending} onClick={() => { onMove(parentId || null); setParentId(""); }}>{labels.move}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
