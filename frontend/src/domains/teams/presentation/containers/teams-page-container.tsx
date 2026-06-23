"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { Button } from "@/components/ui/button";
import { useTeams, useSetActiveTeam } from "../../application/hooks/use-teams";
import { useActiveTeam } from "../../application/hooks/use-active-team";
import { useTeamForm } from "../../application/hooks/use-team-form";
import { TeamList } from "../components/team-list";
import { TeamFormDialog } from "../components/team-form-dialog";

export const TeamsPageContainer: React.FC = () => {
  const t = useTranslations("teams");
  const router = useRouter();
  const { data: teams, isLoading } = useTeams();
  const { activeTeamId } = useActiveTeam();

  const [dialogOpen, setDialogOpen] = useState(false);

  const setActiveTeam = useSetActiveTeam();

  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
  }, []);

  const {
    form,
    isPending,
    onSubmit,
    generateSlug,
  } = useTeamForm(handleCloseDialog);

  const nameValue = form.watch("name");
  const slugValue = form.watch("slug");

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      setActiveTeam.mutate(teamId, {
        onSuccess: () => {
          router.push(`/teams/${teamId}`);
        },
        onError: (error) => {
          showToast.error(error.message);
        },
      });
    },
    [setActiveTeam, router],
  );

  const handleCreateTeam = useCallback(() => {
    form.reset({ name: "", slug: "" });
    setDialogOpen(true);
  }, [form]);

  const handleNameChange = useCallback(
    (value: string) => {
      form.setValue("name", value, { shouldValidate: true });
      // Auto-generate slug if user hasn't manually changed it
      const currentSlug = form.getValues("slug");
      if (!currentSlug || currentSlug === generateSlug(nameValue)) {
        form.setValue("slug", generateSlug(value));
      }
    },
    [form, generateSlug, nameValue],
  );

  const handleSlugChange = useCallback(
    (value: string) => {
      form.setValue("slug", value);
    },
    [form],
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={handleCreateTeam}>
          <Plus className="mr-2 size-4" />
          {t("createTeam")}
        </Button>
      </div>

      {/* Teams list */}
      <TeamList
        teams={teams ?? []}
        activeTeamId={activeTeamId}
        isLoading={isLoading}
        onSelectTeam={handleSelectTeam}
        onCreateTeam={handleCreateTeam}
      />

      {/* Create dialog */}
      <TeamFormDialog
        isOpen={dialogOpen}
        name={nameValue}
        slug={slugValue ?? ""}
        isSubmitting={isPending}
        onNameChange={handleNameChange}
        onSlugChange={handleSlugChange}
        onSubmit={onSubmit}
        onClose={handleCloseDialog}
      />
    </div>
  );
};
