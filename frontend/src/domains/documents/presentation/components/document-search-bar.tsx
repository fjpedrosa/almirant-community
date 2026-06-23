import { useTranslations } from "next-intl";
import { Search, X, FolderOpen, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryChip } from "./category-chip";
import type { DocumentSearchBarProps } from "../../domain/types";

const ALL_PROJECTS_VALUE = "all";

export const DocumentSearchBar: React.FC<DocumentSearchBarProps> = ({
  query,
  onQueryChange,
  projectId,
  onProjectChange,
  categoryId,
  onCategoryChange,
  projects,
  categories,
  isSearching,
}) => {
  const t = useTranslations("documents");

  const handleProjectChange = (value: string) => {
    if (value === ALL_PROJECTS_VALUE) {
      onProjectChange(null);
    } else {
      onProjectChange(value);
    }
  };

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        {isSearching ? (
          <Loader2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground animate-spin" />
        ) : (
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        )}
        <Input
          placeholder={t("search.placeholder")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="pl-9 pr-8 h-9"
          autoFocus
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1 h-7 w-7"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2">
        {/* Project filter */}
        <Select
          value={projectId ?? ALL_PROJECTS_VALUE}
          onValueChange={handleProjectChange}
        >
          <SelectTrigger size="sm" className="w-44 text-xs">
            <FolderOpen className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
            <SelectValue placeholder={t("filters.allProjects")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS_VALUE}>
              {t("filters.allProjects")}
            </SelectItem>
            {projects.length > 0 && <SelectSeparator />}
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  {project.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          <CategoryChip
            name={t("allCategories")}
            color="#8b5cf6"
            isActive={categoryId === null}
            onClick={() => onCategoryChange(null)}
          />
          {categories.map((cat) => (
            <CategoryChip
              key={cat.id}
              name={cat.name}
              color={cat.color}
              isActive={categoryId === cat.id}
              onClick={() =>
                onCategoryChange(cat.id === categoryId ? null : cat.id)
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
};
