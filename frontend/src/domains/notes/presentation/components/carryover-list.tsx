"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { NoteCarryoverSummary } from "../../domain/types";

export const CarryoverList = ({
  items,
  labels,
  onComplete,
  pendingItemId,
  error,
  loading = false,
  queryError = false,
  onRetry,
}: {
  items: NoteCarryoverSummary[];
  labels: { title: string; empty: string; complete: string; from: string; loading?: string; retry?: string; unavailable?: string };
  onComplete: (item: NoteCarryoverSummary) => void;
  pendingItemId?: string | null;
  error?: string | null;
  loading?: boolean;
  queryError?: boolean;
  onRetry?: () => void;
}) => (
  <section aria-labelledby="notes-carryover-title" className="border-b border-border/70 bg-muted/20 px-5 py-4 md:px-10">
    <h2 id="notes-carryover-title" className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {labels.title}
    </h2>
    {error && <p role="alert" className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    {queryError ? (
      <p role="alert" className="text-sm text-destructive">{labels.unavailable ?? "Unable to load carryover."} {onRetry && <Button type="button" variant="ghost" size="xs" onClick={onRetry}>{labels.retry ?? "Retry"}</Button>}</p>
    ) : loading ? (
      <p role="status" className="text-sm text-muted-foreground">{labels.loading ?? "Loading…"}</p>
    ) : items.length === 0 ? (
      <p className="text-sm text-muted-foreground">{labels.empty}</p>
    ) : (
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={`${item.sourcePageId}:${item.itemId}`} className="flex items-start gap-3 text-sm">
            <Checkbox
              aria-label={item.text || labels.complete}
              checked={item.checked}
              disabled={pendingItemId === item.itemId}
              onCheckedChange={(checked) => { if (checked) onComplete(item); }}
              className="mt-0.5"
            />
            <div className="min-w-0">
              <p className="break-words">{item.text || labels.complete}</p>
              {item.sourceDate && <p className="mt-0.5 text-xs text-muted-foreground">{labels.from} {item.sourceDate}</p>}
            </div>
          </li>
        ))}
      </ul>
    )}
  </section>
);
