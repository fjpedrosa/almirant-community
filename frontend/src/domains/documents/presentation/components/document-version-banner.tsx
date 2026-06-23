import { formatDistanceToNow } from "date-fns";
import { History, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import type { DocumentVersionBannerProps } from "../../domain/types";

export const DocumentVersionBanner: React.FC<DocumentVersionBannerProps> = ({
  version,
  isLoadingContent,
  onBackToLatest,
}) => {
  const t = useTranslations("documents.versionHistory");

  const versionLabel = version.commitSha
    ? version.commitSha.slice(0, 7)
    : version.contentHash.slice(0, 7);

  const timeAgo = formatDistanceToNow(new Date(version.createdAt), {
    addSuffix: true,
  });

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
      {isLoadingContent ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400 shrink-0" />
      ) : (
        <History className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      )}
      <span className="text-xs text-amber-800 dark:text-amber-300 flex-1">
        {t("viewingVersion", { hash: versionLabel, time: timeAgo })}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/50"
        onClick={onBackToLatest}
      >
        <ArrowLeft className="h-3 w-3 mr-1" />
        {t("backToLatest")}
      </Button>
    </div>
  );
};
