import { useTranslations } from "next-intl";
import { ArrowLeft, Calendar, FileText, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownPreviewWithAnchors } from "@/domains/shared/presentation/components/markdown-preview-with-anchors";
import { CategoryChip } from "./category-chip";
import type { DocumentViewerProps } from "../../domain/types";

const formatDate = (date: Date): string => {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const DocumentViewerSkeleton: React.FC = () => (
  <div className="flex-1 flex flex-col p-6 gap-4">
    <Skeleton className="h-8 w-2/3" />
    <Skeleton className="h-4 w-1/3" />
    <div className="space-y-3 mt-4">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/6" />
    </div>
  </div>
);

const DocumentViewerError: React.FC<{ error: string; onBack: () => void }> = ({
  error,
  onBack,
}) => {
  const t = useTranslations("common");

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <FileText className="h-12 w-12 text-destructive/50 mx-auto" />
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          {t("back")}
        </Button>
      </div>
    </div>
  );
};

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  title,
  content,
  updatedAt,
  categoryName,
  categoryColor,
  projectName,
  projectColor,
  wordCount,
  isLoading,
  error,
  onBack,
  components,
}) => {
  const t = useTranslations("documents");

  if (isLoading) {
    return <DocumentViewerSkeleton />;
  }

  if (error) {
    return <DocumentViewerError error={error} onBack={onBack} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4 space-y-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onBack}
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold truncate">{title}</h1>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground ml-10">
          {categoryName && categoryColor && (
            <CategoryChip
              name={categoryName}
              color={categoryColor}
              isActive={false}
              onClick={() => {}}
            />
          )}

          {projectName && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: projectColor ?? "#6b7280" }}
              />
              {projectName}
            </span>
          )}

          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDate(updatedAt)}
          </span>

          {wordCount !== null && wordCount > 0 && (
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {t("words", { count: wordCount })}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <MarkdownPreviewWithAnchors
            content={content || t("noContentYet")}
            size="base"
            components={components}
          />
        </div>
      </ScrollArea>
    </div>
  );
};
