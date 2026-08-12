"use client";

import Link from "next/link";
import { ArchiveRestore, ArrowUpRight, FileArchive, Lightbulb, ListTodo, Sprout } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NoteLegacyArchiveSummary, NotePageSummary } from "../../domain/types";

type Labels = {
  pages: string;
  legacy: string;
  emptyPages: string;
  emptyLegacy: string;
  restore: string;
  convert: string;
  converted: string;
  discard: string;
  discardTitle: string;
  discardDescription: string;
  confirmDiscard: string;
  cancel: string;
  pending: string;
  convertedStatus: string;
  discardedStatus: string;
  sourceTodo: string;
  sourceIdea: string;
  sourceSeed: string;
  loadMore: string;
};

const source = {
  todo: { icon: ListTodo, label: "sourceTodo" },
  idea: { icon: Lightbulb, label: "sourceIdea" },
  seed: { icon: Sprout, label: "sourceSeed" },
} as const;

export const NotesArchivePanel = ({
  archivedPages,
  legacyItems,
  labels,
  onRestore,
  onConvert,
  onDiscard,
  onLoadMoreArchived,
  onLoadMoreLegacy,
  hasMoreArchived = false,
  hasMoreLegacy = false,
  pendingId,
}: {
  archivedPages: NotePageSummary[];
  legacyItems: NoteLegacyArchiveSummary[];
  labels: Labels;
  onRestore: (pageId: string, expectedVersion: number) => void;
  onConvert: (archiveId: string) => void;
  onDiscard: (archiveId: string) => void | Promise<void>;
  onLoadMoreArchived?: () => void;
  onLoadMoreLegacy?: () => void;
  hasMoreArchived?: boolean;
  hasMoreLegacy?: boolean;
  pendingId?: string | null;
}) => {
  const [discardId, setDiscardId] = useState<string | null>(null);
  return (
    <div className="space-y-12">
      <section aria-labelledby="archived-notes-heading">
        <h2 id="archived-notes-heading" className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">{labels.pages}</h2>
        {archivedPages.length === 0 ? (
          <div className="border-y border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            <FileArchive className="mx-auto mb-3 size-6" />{labels.emptyPages}
          </div>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {archivedPages.map((page) => (
              <li key={page.id} className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{page.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(page.updatedAt).toLocaleDateString()}</p>
                </div>
                {page.canRestore && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${labels.restore} ${page.title}`}
                    disabled={pendingId === page.id}
                    onClick={() => onRestore(page.id, page.stateVersion)}
                  >
                    <ArchiveRestore className="size-4" />{labels.restore}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasMoreArchived && <Button type="button" variant="ghost" className="mt-3" onClick={onLoadMoreArchived}>{labels.loadMore}</Button>}
      </section>

      <section aria-labelledby="legacy-review-heading">
        <h2 id="legacy-review-heading" className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">{labels.legacy}</h2>
        {legacyItems.length === 0 ? (
          <div className="border-y border-dashed border-border py-10 text-center text-sm text-muted-foreground">{labels.emptyLegacy}</div>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {legacyItems.map((item) => {
              const sourceMeta = source[item.sourceType];
              const SourceIcon = sourceMeta.icon;
              const status = item.disposition === "pending" ? labels.pending : item.disposition === "converted" ? labels.convertedStatus : labels.discardedStatus;
              return (
                <li key={item.id} className="py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <SourceIcon className="size-4 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{labels[sourceMeta.label]}</span>
                        <Badge variant="outline">{status}</Badge>
                      </div>
                      <h3 className="font-medium">{item.sourceTitle}</h3>
                      {item.sourcePreview && <p className="mt-1 line-clamp-3 max-w-3xl text-sm leading-6 text-muted-foreground">{item.sourcePreview}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {item.disposition === "pending" && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`${labels.convert} ${item.sourceTitle}`}
                            disabled={pendingId === item.id}
                            onClick={() => onConvert(item.id)}
                          >{labels.convert}</Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`${labels.discard} ${item.sourceTitle}`}
                            disabled={pendingId === item.id}
                            onClick={() => setDiscardId(item.id)}
                          >{labels.discard}</Button>
                        </>
                      )}
                      {item.disposition === "converted" && item.convertedPageId && (
                        <Button asChild type="button" size="sm" variant="outline">
                          <Link href={`/notes/${item.convertedPageId}`}>{labels.converted}<ArrowUpRight className="size-3.5" /></Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hasMoreLegacy && <Button type="button" variant="ghost" className="mt-3" onClick={onLoadMoreLegacy}>{labels.loadMore}</Button>}
      </section>

      <AlertDialog open={discardId !== null} onOpenChange={(open) => { if (!open) setDiscardId(null); }}>
        <AlertDialogContent data-notes-surface>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <Button type="button" disabled={pendingId === discardId} onClick={() => {
              if (!discardId) return;
              const result = onDiscard(discardId);
              if (result && typeof result.then === "function") void result.then(() => setDiscardId(null));
              else setDiscardId(null);
            }}>{pendingId === discardId ? labels.pending : labels.confirmDiscard}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
