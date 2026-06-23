import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { SuggestedDocsSectionProps } from "../../domain/types";

export const SuggestedDocsSection: React.FC<SuggestedDocsSectionProps> = ({
  suggestions,
  isLoading,
  onLinkDocument,
  isLinking,
}) => {
  const t = useTranslations("workItems.suggestedDocs");

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {suggestions.map((doc) => (
        <div
          key={doc.id}
          className="group flex items-start gap-2 text-sm bg-amber-500/5 border border-amber-500/10 rounded-md px-2.5 py-2 hover:bg-amber-500/10 transition-colors"
        >
          <FileText className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{doc.title}</p>
            {doc.contentPreview && (
              <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                {doc.contentPreview}
              </p>
            )}
            {doc.projectName && (
              <div className="flex items-center gap-1 mt-1">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: doc.projectColor ?? "#6b7280" }}
                />
                <span className="text-[10px] text-muted-foreground">
                  {doc.projectName}
                </span>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 touch-visible"
            onClick={() => onLinkDocument(doc.id)}
            disabled={isLinking}
            title={t("link")}
            aria-label={t("link")}
          >
            <Link className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
};
