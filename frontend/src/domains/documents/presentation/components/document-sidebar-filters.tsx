import { useTranslations } from "next-intl";
import { Search, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DocumentSidebarFiltersProps } from "../../domain/types";

const NO_PROJECT_VALUE = "none";
const ALL_PROJECTS_VALUE = "all";

export const DocumentSidebarFilters: React.FC<DocumentSidebarFiltersProps> = ({
  searchQuery,
  onSearchChange,
  onSearchKeyDown,
  onSearchFocus,
  onSearchBlur,
  projects,
  activeProjectFilter,
  onProjectFilterChange,
  searchDropdownContent,
}) => {
  const t = useTranslations("documents");

  const handleProjectChange = (value: string) => {
    if (value === ALL_PROJECTS_VALUE) {
      onProjectFilterChange(null);
    } else {
      onProjectFilterChange(value);
    }
  };

  return (
    <div className="p-3 space-y-3 border-b shrink-0">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          onFocus={onSearchFocus}
          onBlur={onSearchBlur}
          className="pl-8 h-8 text-sm bg-secondary border-0"
        />
        {searchDropdownContent}
      </div>

      {/* Project filter */}
      <Select
        value={activeProjectFilter ?? ALL_PROJECTS_VALUE}
        onValueChange={handleProjectChange}
      >
        <SelectTrigger size="sm" className="w-full text-xs">
          <FolderOpen className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
          <SelectValue placeholder={t("filters.allProjects")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PROJECTS_VALUE}>
            {t("filters.allProjects")}
          </SelectItem>
          <SelectItem value={NO_PROJECT_VALUE}>
            {t("filters.noProject")}
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
    </div>
  );
};
