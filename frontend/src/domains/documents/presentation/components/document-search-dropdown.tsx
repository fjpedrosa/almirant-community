import { useTranslations } from "next-intl";
import { FileText, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DocumentSearchDropdownProps, DocumentSearchResult } from "../../domain/types";

/**
 * Parses <mark> delimiters from ts_headline into React <mark> elements.
 * Keeps legacy **marker** parsing for compatibility.
 * Falls back to plain text if no markers are found.
 */
const parseHighlightMarkers = (text: string): React.ReactNode => {
  const markParts = text.split(/<mark>(.*?)<\/mark>/g);
  if (markParts.length > 1) {
    return markParts.map((part, i) =>
      i % 2 === 1 ? (
        <mark
          key={`mark-${i}`}
          className="bg-yellow-200/80 dark:bg-yellow-500/30 text-foreground rounded-sm px-0.5"
        >
          {part}
        </mark>
      ) : (
        <span key={`text-${i}`}>{part}</span>
      )
    );
  }

  const legacyParts = text.split(/\*\*(.*?)\*\*/g);
  if (legacyParts.length === 1) return text;

  return legacyParts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={`legacy-mark-${i}`}
        className="bg-yellow-200/80 dark:bg-yellow-500/30 text-foreground rounded-sm px-0.5"
      >
        {part}
      </mark>
    ) : (
      <span key={`legacy-text-${i}`}>{part}</span>
    )
  );
};

const DropdownResultItem: React.FC<{
  result: DocumentSearchResult;
  isSelected: boolean;
  onSelect: (id: string) => void;
}> = ({ result, isSelected, onSelect }) => {
  return (
    <button
      type="button"
      data-search-item
      onMouseDown={(e) => {
        // Prevent blur on the input so the click registers
        e.preventDefault();
        onSelect(result.id);
      }}
      className={`w-full text-left px-2.5 py-2 rounded-md transition-colors cursor-pointer ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50"
      }`}
    >
      {/* Title row */}
      <div className="flex items-center gap-1.5 min-w-0">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate flex-1">
          {parseHighlightMarkers(result.title)}
        </span>
        {result.matchedIn !== "title" && (
          <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground shrink-0">
            {result.matchedIn === "both" ? "title+content" : "content"}
          </span>
        )}
      </div>

      {/* Snippet */}
      {result.snippet && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 ml-5">
          {parseHighlightMarkers(result.snippet)}
        </p>
      )}

      {/* Metadata row */}
      <div className="flex items-center gap-1.5 mt-1 ml-5">
        {result.projectName && (
          <span className="inline-flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: result.projectColor || "#6366f1" }}
            />
            <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
              {result.projectName}
            </span>
          </span>
        )}
        {result.projectName && result.categoryName && (
          <span className="text-[10px] text-muted-foreground/50">·</span>
        )}
        {result.categoryName && (
          <span className="inline-flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: result.categoryColor || "#8b5cf6" }}
            />
            <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
              {result.categoryName}
            </span>
          </span>
        )}
      </div>
    </button>
  );
};

export const DocumentSearchDropdown: React.FC<DocumentSearchDropdownProps> = ({
  results,
  isLoading,
  selectedIndex,
  total,
  showTypeToSearch,
  onSelectResult,
  listRef,
}) => {
  const t = useTranslations("documents");

  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          <span className="ml-2 text-xs text-muted-foreground">
            {t("search.searching")}
          </span>
        </div>
      ) : showTypeToSearch ? (
        <div className="py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {t("search.typeToSearch")}
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {t("search.noResults")}
          </p>
        </div>
      ) : (
        <>
          <div className="px-2.5 py-1.5 border-b">
            <p className="text-[10px] text-muted-foreground">
              {t("search.resultsCount", { count: total })}
            </p>
          </div>
          <ScrollArea className="max-h-[400px]">
            <div ref={listRef} className="p-1 space-y-0.5">
              {results.map((result, index) => (
                <DropdownResultItem
                  key={result.id}
                  result={result}
                  isSelected={index === selectedIndex}
                  onSelect={onSelectResult}
                />
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
};
