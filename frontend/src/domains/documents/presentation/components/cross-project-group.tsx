import { useTranslations } from "next-intl";
import { ChevronRight, BookOpen, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CrossProjectDocumentCard } from "./cross-project-document-card";
import type { CrossProjectGroupProps } from "../../domain/types";

export const CrossProjectGroup: React.FC<CrossProjectGroupProps> = ({
  projectId,
  projectName,
  projectColor,
  documents,
  isExpanded,
  onToggle,
  onDocumentClick,
  recentCount,
}) => {
  const t = useTranslations("documents");
  const isKnowHow = projectId === null;
  const groupLabel = isKnowHow
    ? t("crossProject.knowHow")
    : projectName || t("crossProject.unknownProject");

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* Group header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-accent/30 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-90"
          )}
        />
        {isKnowHow ? (
          <BookOpen className="h-4 w-4 text-amber-500" />
        ) : (
          <FolderOpen
            className="h-4 w-4"
            style={{ color: projectColor || "#6366f1" }}
          />
        )}
        <span className="text-sm font-medium">{groupLabel}</span>
        {recentCount != null && recentCount > 0 && (
          <Badge
            variant="secondary"
            className="text-xs bg-blue-500/10 text-blue-600 border-blue-200"
          >
            {recentCount}
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs ml-auto">
          {documents.length}
        </Badge>
      </button>

      {/* Documents grid */}
      {isExpanded && (
        <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {documents.map((doc) => (
            <CrossProjectDocumentCard
              key={doc.id}
              id={doc.id}
              title={doc.title}
              categoryName={doc.categoryName}
              categoryColor={doc.categoryColor}
              wordCount={doc.wordCount}
              isPinned={doc.isPinned}
              updatedAt={doc.updatedAt}
              onClick={() => onDocumentClick(doc.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
