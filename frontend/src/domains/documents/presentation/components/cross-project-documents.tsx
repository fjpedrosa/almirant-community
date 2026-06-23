import { useTranslations } from "next-intl";
import { Search, Library } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryChip } from "./category-chip";
import { CrossProjectGroup } from "./cross-project-group";
import type { CrossProjectDocumentsProps } from "../../domain/types";

const KNOWHOW_KEY = "__knowhow__";

const LoadingSkeleton: React.FC = () => (
  <div className="space-y-4 p-6">
    {[1, 2, 3].map((i) => (
      <div key={i} className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 px-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    ))}
  </div>
);

export const CrossProjectDocuments: React.FC<CrossProjectDocumentsProps> = ({
  groups,
  isLoading,
  searchQuery,
  onSearchChange,
  categories,
  activeCategoryId,
  onCategoryChange,
  expandedGroups,
  onToggleGroup,
  onDocumentClick,
}) => {
  const t = useTranslations("documents");

  return (
    <div className="flex flex-col h-full">
      {/* Header with filters */}
      <div className="border-b px-6 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <Library className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">
            {t("crossProject.title")}
          </h2>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 h-8 text-sm bg-secondary border-0"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <CategoryChip
              name={t("allCategories")}
              color="#8b5cf6"
              isActive={activeCategoryId === null}
              onClick={() => onCategoryChange(null)}
            />
            {categories.map((cat) => (
              <CategoryChip
                key={cat.id}
                name={cat.name}
                color={cat.color}
                count={cat.documentCount}
                isActive={activeCategoryId === cat.id}
                onClick={() =>
                  onCategoryChange(
                    cat.id === activeCategoryId ? null : cat.id
                  )
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : groups.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Library className="h-12 w-12 text-muted-foreground/50 mx-auto" />
            <p className="text-sm text-muted-foreground">
              {t("noDocumentsFound")}
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-3">
            {groups.map((group) => {
              const groupKey = group.projectId ?? KNOWHOW_KEY;
              return (
                <CrossProjectGroup
                  key={groupKey}
                  projectId={group.projectId}
                  projectName={group.projectName}
                  projectColor={group.projectColor}
                  documents={group.documents}
                  isExpanded={expandedGroups.has(groupKey)}
                  onToggle={() => onToggleGroup(groupKey)}
                  onDocumentClick={onDocumentClick}
                  recentCount={group.recentCount}
                />
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
