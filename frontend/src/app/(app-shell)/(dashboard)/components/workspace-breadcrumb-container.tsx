"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCurrentUserTeams } from "@/domains/teams/application/hooks/use-current-user-teams";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { TeamFormDialog } from "@/domains/teams/presentation/components/team-form-dialog";
import { useTeamForm } from "@/domains/teams/application/hooks/use-team-form";
import {
  WorkspaceBreadcrumb,
  WorkspaceList,
  type Workspace,
} from "./workspace-breadcrumb";

/**
 * Container component for workspace breadcrumb with popover switching.
 * Manages state and wires hooks to presentational components.
 */
export const WorkspaceBreadcrumbContainer: React.FC = () => {
  const router = useRouter();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { teams, isLoading: isLoadingTeams } = useCurrentUserTeams();
  const {
    activeTeam,
    activeTeamId,
    confirmedActiveTeamId,
    isLoading: isLoadingActiveTeam,
    isSwitchingTeam,
    switchError,
    setActiveTeam,
  } = useActiveTeam();

  const handleCloseDialog = useCallback(() => {
    setCreateDialogOpen(false);
  }, []);

  const { form, isPending, onSubmit, generateSlug } = useTeamForm(handleCloseDialog);
  const nameValue = form.watch("name");
  const slugValue = form.watch("slug");

  const isLoading = isLoadingTeams || isLoadingActiveTeam;
  const hasMultipleWorkspaces = teams.length > 1;

  // Convert activeTeam to Workspace type
  const activeWorkspace: Workspace | null = activeTeam
    ? {
        id: activeTeam.id,
        name: activeTeam.name,
        slug: activeTeam.slug,
        logo: activeTeam.logo,
      }
    : null;

  const handleSwitchWorkspace = useCallback(
    async (workspaceId: string) => {
      setPopoverOpen(false);
      try {
        await setActiveTeam(workspaceId);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : switchError ?? "Failed to switch workspace";
        showToast.error(message);
      }
    },
    [setActiveTeam, switchError],
  );

  const handleManageWorkspace = useCallback(
    (workspaceId: string) => {
      setPopoverOpen(false);
      router.push(`/teams/${workspaceId}`);
    },
    [router],
  );

  const handleCreateWorkspace = useCallback(() => {
    setPopoverOpen(false);
    form.reset({ name: "", slug: "" });
    setCreateDialogOpen(true);
  }, [form]);

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    setPopoverOpen(open);
  }, []);

  // Single workspace: no popover needed
  if (!hasMultipleWorkspaces) {
    return (
      <WorkspaceBreadcrumb
        activeWorkspace={activeWorkspace}
        isLoading={isLoading}
        isSwitching={isSwitchingTeam}
        hasMultipleWorkspaces={false}
        isPopoverOpen={false}
        onPopoverOpenChange={() => {}}
      />
    );
  }

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
        <PopoverTrigger asChild>
          <div>
            <WorkspaceBreadcrumb
              activeWorkspace={activeWorkspace}
              isLoading={isLoading}
              isSwitching={isSwitchingTeam}
              hasMultipleWorkspaces={hasMultipleWorkspaces}
              isPopoverOpen={popoverOpen}
              onPopoverOpenChange={handlePopoverOpenChange}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <WorkspaceList
            workspaces={teams}
            activeWorkspaceId={activeTeamId}
            confirmedActiveWorkspaceId={confirmedActiveTeamId}
            isSwitching={isSwitchingTeam}
            onSwitchWorkspace={handleSwitchWorkspace}
            onManageWorkspace={handleManageWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
          />
        </PopoverContent>
      </Popover>

      <TeamFormDialog
        isOpen={createDialogOpen}
        name={nameValue}
        slug={slugValue ?? ""}
        isSubmitting={isPending}
        onNameChange={(v) => {
          form.setValue("name", v, { shouldValidate: true });
          const currentSlug = form.getValues("slug");
          if (!currentSlug || currentSlug === generateSlug(nameValue)) {
            form.setValue("slug", generateSlug(v));
          }
        }}
        onSlugChange={(v) => form.setValue("slug", v)}
        onSubmit={onSubmit}
        onClose={handleCloseDialog}
      />
    </>
  );
};
