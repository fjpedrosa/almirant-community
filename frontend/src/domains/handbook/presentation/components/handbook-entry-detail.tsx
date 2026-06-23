"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import type { HandbookEntry } from "../../domain/types";

interface HandbookEntryDetailProps {
  entry: HandbookEntry | null;
}

export const HandbookEntryDetail: React.FC<HandbookEntryDetailProps> = ({ entry }) => {
  if (!entry) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center p-8">
        <Card className="max-w-md text-center">
          <CardHeader>
            <CardTitle>No handbook entry selected</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Import the Builder Handbook or select an existing pattern from the list.
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="space-y-3 border-b bg-background p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{entry.category}</Badge>
          <Badge variant="outline" className="capitalize">{entry.status}</Badge>
          <Badge variant="secondary" className="capitalize">{entry.sourceType}</Badge>
          {entry.sourcePath && <span className="text-xs text-muted-foreground">{entry.sourcePath}</span>}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{entry.title}</h1>
          {entry.summary && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{entry.summary}</p>}
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="mx-auto max-w-4xl p-6">
          <MarkdownPreview content={entry.content} size="sm" />
        </div>
      </ScrollArea>
    </main>
  );
};
