"use client";

import { BookOpen, CheckCircle2, Clock, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { HandbookCategorySummary, HandbookEntry } from "../../domain/types";

interface HandbookEntryListProps {
  entries: HandbookEntry[];
  selectedEntryId: string | null;
  categories: HandbookCategorySummary[];
  search: string;
  selectedCategory: string;
  isLoading: boolean;
  isImporting: boolean;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSelectEntry: (entry: HandbookEntry) => void;
  onImportDefault: () => void;
}

const statusIcon = (status: HandbookEntry["status"]) => {
  if (status === "verified") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "deprecated") return <Clock className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
};

export const HandbookEntryList: React.FC<HandbookEntryListProps> = ({
  entries,
  selectedEntryId,
  categories,
  search,
  selectedCategory,
  isLoading,
  isImporting,
  onSearchChange,
  onCategoryChange,
  onSelectEntry,
  onImportDefault,
}) => (
  <aside className="flex h-full min-h-0 w-full flex-col border-r bg-card md:w-[360px]">
    <div className="space-y-3 border-b p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <BookOpen className="h-4 w-4 text-primary" />
            Handbook
          </h2>
          <p className="text-xs text-muted-foreground">Curated implementation patterns</p>
        </div>
        <Button size="sm" variant="outline" onClick={onImportDefault} disabled={isImporting}>
          {isImporting ? "Importing..." : "Import"}
        </Button>
      </div>

      <Input
        placeholder="Search auth, cron jobs, backoffice..."
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={selectedCategory === "all" ? "default" : "outline"}
          onClick={() => onCategoryChange("all")}
        >
          All
        </Button>
        {categories.map((category) => (
          <Button
            key={category.category}
            size="sm"
            variant={selectedCategory === category.category ? "default" : "outline"}
            onClick={() => onCategoryChange(category.category)}
          >
            {category.category}
            <span className="ml-1 text-xs opacity-70">{category.count}</span>
          </Button>
        ))}
      </div>
    </div>

    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-2 p-3">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading handbook...</p>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No handbook entries yet. Import the Builder Handbook seed to get started.
          </div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelectEntry(entry)}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
                selectedEntryId === entry.id && "border-primary bg-primary/10",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 text-sm font-medium">{entry.title}</h3>
                <Badge variant="outline" className="gap-1 text-[10px] capitalize">
                  {statusIcon(entry.status)}
                  {entry.status}
                </Badge>
              </div>
              {entry.summary && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{entry.summary}</p>
              )}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="text-[10px]">{entry.category}</Badge>
                <span>{entry.sourceType}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </ScrollArea>
  </aside>
);
