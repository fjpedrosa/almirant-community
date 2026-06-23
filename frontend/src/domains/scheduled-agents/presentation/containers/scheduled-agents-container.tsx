"use client";

import { useMemo, useState } from "react";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useScheduledAgents } from "../../application/hooks/use-scheduled-agents";
import {
  useCreateScheduledAgent,
  useUpdateScheduledAgent,
  useDeleteScheduledAgent,
  useToggleScheduledAgent,
  useTriggerScheduledAgent,
} from "../../application/hooks/use-scheduled-agent-mutations";
import { useAgentFormDrawer } from "../../application/hooks/use-agent-form-drawer";
import { useSkillsForSelector } from "@/domains/skills/application/hooks/use-skills";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import type { ProjectOption } from "../../domain/types";
import { ScheduledAgentsList } from "../components/scheduled-agents-list";
import { AgentFormDrawer } from "../components/agent-form-drawer";
import type {
  ScheduledAgentConfig,
  CreateScheduledAgentData,
  UpdateScheduledAgentData,
} from "../../domain/types";

export const ScheduledAgentsContainer = () => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ScheduledAgentConfig | null>(null);
  const [deletingConfig, setDeletingConfig] = useState<ScheduledAgentConfig | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const { data: configs = [], isLoading } = useScheduledAgents();
  const { data: skills = [] } = useSkillsForSelector();
  const { data: rawProjects = [] } = useProjects();

  const projects: ProjectOption[] = rawProjects.map((p) => ({
    id: p.id,
    name: p.name,
    hasRepository: (p.repositories?.length ?? 0) > 0,
  }));

  const projectColors = useMemo(
    () =>
      rawProjects.reduce<Record<string, string>>((acc, project) => {
        if (project.color) acc[project.id] = project.color;
        return acc;
      }, {}),
    [rawProjects],
  );
  const createMutation = useCreateScheduledAgent();
  const updateMutation = useUpdateScheduledAgent();
  const deleteMutation = useDeleteScheduledAgent();
  const toggleMutation = useToggleScheduledAgent();
  const triggerMutation = useTriggerScheduledAgent();

  const handleOpenCreate = () => {
    setEditingConfig(null);
    setIsFormOpen(true);
  };

  const handleEdit = (config: ScheduledAgentConfig) => {
    setEditingConfig(config);
    setIsFormOpen(true);
  };

  const handleToggle = (config: ScheduledAgentConfig) => {
    toggleMutation.mutate({ id: config.id, enabled: !config.enabled });
  };

  const handleTrigger = (config: ScheduledAgentConfig) => {
    setTriggeringId(config.id);
    triggerMutation.mutate(config.id, {
      onSettled: () => setTriggeringId(null),
    });
  };

  const handleDelete = (config: ScheduledAgentConfig) => {
    setDeletingConfig(config);
  };

  const handleConfirmDelete = () => {
    if (deletingConfig) {
      deleteMutation.mutate(deletingConfig.id, {
        onSuccess: () => setDeletingConfig(null),
      });
    }
  };

  const handleFormSubmit = (data: CreateScheduledAgentData | UpdateScheduledAgentData) => {
    if (editingConfig) {
      updateMutation.mutate(
        { id: editingConfig.id, data: data as UpdateScheduledAgentData },
        {
          onSuccess: () => {
            setIsFormOpen(false);
            setEditingConfig(null);
          },
        }
      );
    } else {
      createMutation.mutate(data as CreateScheduledAgentData, {
        onSuccess: () => {
          setIsFormOpen(false);
        },
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Use the agent form drawer hook
  const {
    form,
    onSubmit,
    skills: flatSkills,
    userSkills,
    scheduleType,
    trigger,
    isEditing,
    availableProviders,
    availableModels,
    availableReasoningLevels,
    agentKind,
    automationTargetKind,
    builtinAutomationId,
    automationSkillSlug,
    automationProjectIds,
    backlogDrainEnabled,
    backlogDrainProjectIds,
    backlogDrainWorkItems,
    isLoadingBacklogDrainWorkItems,
    backlogDrainPreview,
    isLoadingBacklogDrainPreview,
    webhookProposal,
    isLoadingWebhookProposal,
  } = useAgentFormDrawer({
    open: isFormOpen,
    config: editingConfig,
    onSubmit: handleFormSubmit,
    skills,
    projects,
  });

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto w-full">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Bot className="h-6 w-6 text-primary" />
            Agents
          </h1>
          <p className="text-muted-foreground">
            Configure your automated agents
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Agent
        </Button>
      </div>

      <ScheduledAgentsList
        items={configs}
        isLoading={isLoading}
        triggeringId={triggeringId}
        projectColors={projectColors}
        onToggle={handleToggle}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onTrigger={handleTrigger}
      />

      <AgentFormDrawer
        key={isFormOpen ? (editingConfig?.id ?? "new") : "closed"}
        open={isFormOpen}
        onOpenChange={(open) => {
          setIsFormOpen(open);
          if (!open) setEditingConfig(null);
        }}
        isEditing={isEditing}
        isPending={isPending}
        form={form}
        onSubmit={onSubmit}
        skills={flatSkills}
        userSkills={userSkills}
        projects={projects}
        scheduleType={scheduleType}
        trigger={trigger}
        webhookProposal={webhookProposal}
        isLoadingWebhookProposal={isLoadingWebhookProposal}
        availableProviders={availableProviders}
        availableModels={availableModels}
        availableReasoningLevels={availableReasoningLevels}
        agentKind={agentKind}
        automationTargetKind={automationTargetKind}
        builtinAutomationId={builtinAutomationId}
        automationSkillSlug={automationSkillSlug}
        automationProjectIds={automationProjectIds}
        backlogDrainEnabled={backlogDrainEnabled}
        backlogDrainProjectIds={backlogDrainProjectIds}
        backlogDrainWorkItems={backlogDrainWorkItems}
        isLoadingBacklogDrainWorkItems={isLoadingBacklogDrainWorkItems}
        backlogDrainPreview={backlogDrainPreview}
        isLoadingBacklogDrainPreview={isLoadingBacklogDrainPreview}
      />

      <AlertDialog
        open={!!deletingConfig}
        onOpenChange={(open) => !open && setDeletingConfig(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scheduled Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deletingConfig?.name}&quot;? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
