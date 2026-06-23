import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import type { DocumentSearchResultItemProps } from "../../domain/types";

/**
 * Parses **marker** delimiters from tsvector ts_headline into <mark> elements.
 * Falls back to client-side regex highlighting if no markers are present.
 */
const highlightText = (text: string, query: string): React.ReactNode => {
  // If text contains **markers** from backend tsvector, parse those
  if (text.includes("**")) {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    if (parts.length > 1) {
      return parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-yellow-200/80 dark:bg-yellow-500/30 text-foreground rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      );
    }
  }

  // Fallback: client-side regex highlighting (for title matches without markers)
  if (!query.trim()) return text;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, index) =>
    regex.test(part) ? (
      <mark
        key={index}
        className="bg-yellow-200/80 dark:bg-yellow-500/30 text-foreground rounded-sm px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
};

export const DocumentSearchResultItem: React.FC<DocumentSearchResultItemProps> = ({
  title,
  snippet,
  categoryName,
  categoryColor,
  projectName,
  projectColor,
  wordCount,
  updatedAt,
  matchedIn,
  searchQuery,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 rounded-lg hover:bg-accent/50 transition-colors border border-transparent hover:border-border/50"
    >
      {/* Title row */}
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-sm font-medium flex-1 line-clamp-1">
          {highlightText(title, searchQuery)}
        </p>
        {matchedIn !== "title" && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 shrink-0"
          >
            {matchedIn === "both" ? "title + content" : "content"}
          </Badge>
        )}
      </div>

      {/* Snippet */}
      {snippet && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 ml-6">
          {highlightText(snippet, searchQuery)}
        </p>
      )}

      {/* Metadata row */}
      <div className="flex items-center gap-2 mt-1.5 ml-6">
        {projectName && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 shrink-0 gap-1 font-normal"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: projectColor || "#6366f1" }}
            />
            {projectName}
          </Badge>
        )}
        {categoryName && (
          <span className="inline-flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: categoryColor || "#8b5cf6" }}
            />
            <span className="text-[10px] text-muted-foreground">
              {categoryName}
            </span>
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
        </span>
        {wordCount !== null && wordCount !== undefined && (
          <span className="text-[10px] text-muted-foreground">
            {wordCount}w
          </span>
        )}
      </div>
    </button>
  );
};
