import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkspaceSelectorProps } from "../../domain/types";

// ---------------------------------------------------------------------------
// WorkspaceSelector - Purely presentational
// ---------------------------------------------------------------------------
// Allows selecting which active workspace should be used for workspace-scoped
// integrations (GitHub, Vercel, Sentry, PostHog).
// ---------------------------------------------------------------------------

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
  value,
  options,
  isLoading,
  isSwitching,
  onChange,
}) => (
  <div className="space-y-1">
    <div className="flex items-center gap-2">
      <p className="text-xs text-muted-foreground">Workspace</p>
      {isSwitching && (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      )}
    </div>
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={isLoading || isSwitching || options.length === 0}
    >
      <SelectTrigger className="w-[230px]">
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent>
        {options.map((workspace) => (
          <SelectItem key={workspace.id} value={workspace.id}>
            {workspace.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
