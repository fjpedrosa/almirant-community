import { formatDistanceToNow } from "date-fns";
import { GitCommit, Loader2, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import type { DocumentVersionHistoryProps } from "../../domain/types";

export const DocumentVersionHistory: React.FC<
  DocumentVersionHistoryProps
> = ({ versions, selectedVersionHash, onSelectVersion, isLoading }) => {
  const t = useTranslations("documents.versionHistory");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  if (versions.length === 0) {
    return null;
  }

  return (
    <div className="border-b bg-card/30">
      <div className="px-4 py-2">
        <div className="flex items-center gap-1.5 mb-2">
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {t("title")}
          </p>
        </div>
        <div className="space-y-0.5">
          {versions.map((version, index) => {
            const isLatest = index === 0;
            const isSelected =
              selectedVersionHash === version.contentHash;

            return (
              <button
                key={version.id}
                onClick={() => onSelectVersion(version)}
                className={cn(
                  "w-full text-left px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-2",
                  isSelected
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-accent/50"
                )}
              >
                <GitCommit className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {version.commitSha
                    ? version.commitSha.slice(0, 7)
                    : version.contentHash.slice(0, 7)}
                </span>
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {formatDistanceToNow(new Date(version.createdAt), {
                    addSuffix: true,
                  })}
                </span>
                {isLatest && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                  >
                    {t("latest")}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
