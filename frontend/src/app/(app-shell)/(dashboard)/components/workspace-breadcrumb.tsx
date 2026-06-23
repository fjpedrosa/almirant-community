import { ChevronDown, Loader2, Settings, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
}

interface WorkspaceBreadcrumbProps {
  /** Currently active workspace */
  activeWorkspace: Workspace | null;
  /** Whether data is loading */
  isLoading: boolean;
  /** Whether a workspace switch is in progress */
  isSwitching: boolean;
  /** Whether the user has multiple workspaces */
  hasMultipleWorkspaces: boolean;
  /** Whether the popover is open */
  isPopoverOpen: boolean;
  /** Callback to open/close popover */
  onPopoverOpenChange: (open: boolean) => void;
}

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

/**
 * Workspace breadcrumb trigger component.
 * Shows Logo / WorkspaceName with optional chevron for switching.
 * Purely presentational - receives all state via props.
 */
export const WorkspaceBreadcrumb: React.FC<WorkspaceBreadcrumbProps> = ({
  activeWorkspace,
  isLoading,
  isSwitching,
  hasMultipleWorkspaces,
  isPopoverOpen,
  onPopoverOpenChange,
}) => {
  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <Skeleton className="size-5 rounded-full" />
        <span className="text-muted-foreground">/</span>
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  // No workspace selected
  if (!activeWorkspace) {
    return null;
  }

  const needsTruncation = activeWorkspace.name.length > 20;
  const canSwitch = hasMultipleWorkspaces && !isSwitching;

  const breadcrumbContent = (
    <button
      type="button"
      className={`
        inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm
        ${canSwitch ? "hover:bg-accent cursor-pointer" : "cursor-default"}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
      `}
      onClick={() => {
        if (canSwitch) {
          onPopoverOpenChange(!isPopoverOpen);
        }
      }}
      aria-label={hasMultipleWorkspaces ? "Switch workspace" : activeWorkspace.name}
      aria-expanded={hasMultipleWorkspaces ? isPopoverOpen : undefined}
      aria-haspopup={hasMultipleWorkspaces ? "true" : undefined}
      disabled={isSwitching}
    >
      <Avatar className="size-5">
        {activeWorkspace.logo && (
          <AvatarImage src={activeWorkspace.logo} alt={activeWorkspace.name} />
        )}
        <AvatarFallback className="text-[10px]">
          {getInitials(activeWorkspace.name)}
        </AvatarFallback>
      </Avatar>
      <span className="text-muted-foreground">/</span>
      <span className="max-w-[150px] truncate">{activeWorkspace.name}</span>
      {isSwitching ? (
        <Loader2 className="size-3.5 text-muted-foreground animate-spin" />
      ) : hasMultipleWorkspaces ? (
        <ChevronDown className="size-3.5 text-muted-foreground" />
      ) : null}
    </button>
  );

  // Wrap with tooltip if name is truncated
  if (needsTruncation) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{breadcrumbContent}</TooltipTrigger>
          <TooltipContent>
            <p>{activeWorkspace.name}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return breadcrumbContent;
};

interface WorkspaceListItemProps {
  workspace: Workspace;
  isActive: boolean;
  isConfirmedActive: boolean;
  isPendingSelection: boolean;
  isSwitching: boolean;
  onSelect: () => void;
  onManage: () => void;
}

/**
 * Single workspace item in the popover list.
 * Purely presentational.
 */
export const WorkspaceListItem: React.FC<WorkspaceListItemProps> = ({
  workspace,
  isActive,
  isConfirmedActive,
  isPendingSelection,
  isSwitching,
  onSelect,
  onManage,
}) => {
  return (
    <button
      type="button"
      className={`
        flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm
        ${isActive ? "bg-accent" : "hover:bg-accent"}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      `}
      onClick={() => {
        if (!isSwitching && !isActive) {
          onSelect();
        }
      }}
      disabled={isSwitching || isActive}
    >
      <div className="flex items-center gap-2">
        <Avatar className="size-5">
          {workspace.logo && (
            <AvatarImage src={workspace.logo} alt={workspace.name} />
          )}
          <AvatarFallback className="text-[10px]">
            {getInitials(workspace.name)}
          </AvatarFallback>
        </Avatar>
        <span className={cn("truncate", isActive && !isPendingSelection && "text-primary")}>{workspace.name}</span>
      </div>
      <div className="flex items-center gap-1">
        {isPendingSelection && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
        {isConfirmedActive && (
          <button
            type="button"
            className="p-0.5 rounded hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onManage();
            }}
          >
            <Settings className="size-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </button>
  );
};

interface WorkspaceListProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  confirmedActiveWorkspaceId: string | null;
  isSwitching: boolean;
  onSwitchWorkspace: (workspaceId: string) => void;
  onManageWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: () => void;
}

/**
 * Workspace list component for the popover content.
 * Shows all workspaces with active indicator and management actions.
 */
export const WorkspaceList: React.FC<WorkspaceListProps> = ({
  workspaces,
  activeWorkspaceId,
  confirmedActiveWorkspaceId,
  isSwitching,
  onSwitchWorkspace,
  onManageWorkspace,
  onCreateWorkspace,
}) => {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground font-normal uppercase tracking-wider px-2 py-1">
        Workspaces
      </p>
      <div className="flex flex-col gap-0.5">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          const isConfirmedActive = workspace.id === confirmedActiveWorkspaceId;
          const isPendingSelection = isSwitching && isActive && !isConfirmedActive;
          return (
            <WorkspaceListItem
              key={workspace.id}
              workspace={workspace}
              isActive={isActive}
              isConfirmedActive={isConfirmedActive}
              isPendingSelection={isPendingSelection}
              isSwitching={isSwitching}
              onSelect={() => onSwitchWorkspace(workspace.id)}
              onManage={() => onManageWorkspace(workspace.id)}
            />
          );
        })}
      </div>
      <div className="border-t my-1" />
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onCreateWorkspace}
      >
        <Plus className="size-4" />
        <span>Create workspace</span>
      </button>
    </div>
  );
};
