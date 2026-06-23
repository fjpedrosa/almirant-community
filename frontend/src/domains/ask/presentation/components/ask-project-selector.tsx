import { FolderKanban } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// Component: AskProjectSelector
// ---------------------------------------------------------------------------
// Project selection dropdown for scoping Ask queries.
// ---------------------------------------------------------------------------

interface Project {
  id: string;
  name: string;
}

export interface AskProjectSelectorProps {
  projects: Project[];
  selectedProjectId: string | null;
  onProjectChange: (projectId: string) => void;
  isLoading: boolean;
}

export const AskProjectSelector: React.FC<AskProjectSelectorProps> = ({
  projects,
  selectedProjectId,
  onProjectChange,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-48" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FolderKanban className="size-4" />
        <span>Project:</span>
      </div>
      <Select
        value={selectedProjectId ?? undefined}
        onValueChange={onProjectChange}
      >
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Select a project" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
