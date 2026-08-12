"use client";

import { useState } from "react";
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
import type { NoteMember, NotePageShareSummary, NoteShareRole } from "../../domain/types";

export const ShareDialog = ({
  open,
  members,
  shares,
  inheritedAccess,
  labels,
  onSave,
  onRemove,
  onOpenChange,
  pending = false,
  error,
  membersError,
  onRetryMembers,
}: {
  open: boolean;
  members: NoteMember[];
  shares: NotePageShareSummary[];
  inheritedAccess: boolean;
  labels: { title: string; description: string; inherited: string; member: string; role: string; viewer: string; editor: string; save: string; remove: string; close: string; retryMembers?: string };
  onSave: (userId: string, role: NoteShareRole) => void;
  onRemove: (userId: string) => void;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  error?: string | null;
  membersError?: string | null;
  onRetryMembers?: () => void;
}) => {
  const [userId, setUserId] = useState(members[0]?.id ?? "");
  const [role, setRole] = useState<NoteShareRole>("viewer");
  const selectedUserId = members.some((member) => member.id === userId) ? userId : members[0]?.id ?? "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-notes-surface>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {inheritedAccess && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{labels.inherited}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="notes-share-member">{labels.member}</Label>
            <select id="notes-share-member" disabled={Boolean(membersError) || pending} value={selectedUserId} onChange={(event) => setUserId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              {members.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes-share-role">{labels.role}</Label>
            <select id="notes-share-role" value={role} onChange={(event) => setRole(event.target.value as NoteShareRole)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="viewer">{labels.viewer}</option>
              <option value="editor">{labels.editor}</option>
            </select>
          </div>
        </div>
        {membersError && <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm" role="alert"><span>{membersError}</span>{onRetryMembers && <Button type="button" variant="outline" size="sm" onClick={onRetryMembers}>{labels.retryMembers ?? "Retry"}</Button>}</div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {shares.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {shares.map((share) => {
              const member = members.find((candidate) => candidate.id === share.sharedWithUserId);
              return (
                <li key={share.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>{member?.name || member?.email || share.sharedWithUserId} · {share.role === "editor" ? labels.editor : labels.viewer}</span>
                  <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`${labels.remove} ${member?.name || member?.email || share.sharedWithUserId}`} onClick={() => onRemove(share.sharedWithUserId)}>{labels.remove}</Button>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{labels.close}</Button>
          <Button type="button" disabled={!selectedUserId || Boolean(membersError) || pending} onClick={() => onSave(selectedUserId, role)}>{labels.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
