"use client";

import { Archive, Share2, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { noteActions } from "../../domain/capabilities";
import type { NotePageSummary, NoteVisibility } from "../../domain/types";

export const NotePageActions = ({
  page,
  labels,
  disabled = false,
  onShare,
  onMove,
  onArchive,
  onVisibility,
}: {
  page: NotePageSummary;
  labels: { actions: string; share: string; move: string; archive: string; visibility: string; private: string; workspace: string };
  disabled?: boolean;
  onShare: () => void;
  onMove: () => void;
  onArchive: () => void;
  onVisibility: (visibility: NoteVisibility) => void;
}) => {
  const actions = noteActions(page, page.kind, false);
  if (!actions.share && !actions.reparent && !actions.archive && !actions.visibility) return null;
  return (
    <div aria-label={labels.actions} className="flex flex-wrap items-center justify-end gap-1.5">
      {actions.visibility && (
        <select
          aria-label={labels.visibility}
          value={page.visibility}
          disabled={disabled}
          onChange={(event) => onVisibility(event.target.value as NoteVisibility)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
        >
          <option value="private">{labels.private}</option>
          <option value="workspace">{labels.workspace}</option>
        </select>
      )}
      {actions.share && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onShare}><Share2 className="size-3.5" />{labels.share}</Button>}
      {actions.reparent && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onMove}><Waypoints className="size-3.5" />{labels.move}</Button>}
      {actions.archive && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onArchive}><Archive className="size-3.5" />{labels.archive}</Button>}
    </div>
  );
};
