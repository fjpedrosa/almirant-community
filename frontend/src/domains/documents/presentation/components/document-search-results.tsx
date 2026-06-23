import { useTranslations } from "next-intl";
import { Search, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocumentSearchResultItem } from "./document-search-result-item";
import type { DocumentSearchResultsProps } from "../../domain/types";

export const DocumentSearchResults: React.FC<DocumentSearchResultsProps> = ({
  results,
  searchQuery,
  isLoading,
  total,
  onResultClick,
}) => {
  const t = useTranslations("documents");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">
          {t("search.searching")}
        </span>
      </div>
    );
  }

  if (!searchQuery.trim() || searchQuery.trim().length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Search className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          {t("search.hint")}
        </p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Search className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          {t("search.noResults")}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {t("search.noResultsHint")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="px-4 py-2 border-b">
        <p className="text-xs text-muted-foreground">
          {t("search.resultsCount", { count: total })}
        </p>
      </div>
      <ScrollArea className="max-h-[60vh]">
        <div className="p-2 space-y-1">
          {results.map((result) => (
            <DocumentSearchResultItem
              key={result.id}
              id={result.id}
              title={result.title}
              snippet={result.snippet}
              categoryName={result.categoryName}
              categoryColor={result.categoryColor}
              projectName={result.projectName}
              projectColor={result.projectColor}
              wordCount={result.wordCount}
              updatedAt={result.updatedAt}
              matchedIn={result.matchedIn}
              searchQuery={searchQuery}
              onClick={() => onResultClick(result.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
