"use client";

import { useState, useCallback, useMemo } from "react";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import type { UseFormReturn } from "react-hook-form";
import type { WorkItemFormData } from "../../domain/types";
import type { SelectableUser } from "@/domains/teams/domain/types";

/**
 * Manages the multi-select assignee state, syncing selected user IDs
 * to the form's `assignee` string field for backward compatibility.
 *
 * When an active team exists, the assignee field is populated with
 * the first selected user's name (keeps existing API contract).
 * Additional assignees are stored but the primary assignee name
 * is what gets sent to the backend.
 */
export const useAssigneeSelect = (form: UseFormReturn<WorkItemFormData>) => {
  const { members, isLoading, hasActiveTeam } = useTeamMembersSelect();
  const { user } = useAuth();
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);

  const availableAssignees: SelectableUser[] = useMemo(
    () =>
      members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        image: m.image ?? null,
      })),
    [members]
  );

  // Sync selected user IDs -> form `assignee` field (first user's name)
  const syncAssigneeField = useCallback(
    (ids: string[]) => {
      const currentAssignee = form.getValues("assignee");
      if (ids.length === 0) {
        if (currentAssignee !== "") {
          form.setValue("assignee", "", { shouldDirty: true });
        }
        return;
      }
      const firstUser = availableAssignees.find((u) => u.id === ids[0]);
      const nextAssignee = firstUser?.name ?? "";
      if (currentAssignee !== nextAssignee) {
        form.setValue("assignee", nextAssignee, { shouldDirty: true });
      }
    },
    [form, availableAssignees]
  );

  const onSelectAssignee = useCallback(
    (userId: string) => {
      setSelectedAssigneeIds((prev) => {
        const next = [...prev, userId];
        syncAssigneeField(next);
        return next;
      });
    },
    [syncAssigneeField]
  );

  const onRemoveAssignee = useCallback(
    (userId: string) => {
      setSelectedAssigneeIds((prev) => {
        const next = prev.filter((id) => id !== userId);
        syncAssigneeField(next);
        return next;
      });
    },
    [syncAssigneeField]
  );

  // "Assign to me" for multi-select mode: add current user if not already selected
  const handleAssignToMe = useCallback(() => {
    if (!user?.id) return;

    if (hasActiveTeam) {
      const alreadySelected = selectedAssigneeIds.includes(user.id);
      if (!alreadySelected) {
        onSelectAssignee(user.id);
      }
    } else if (user.name) {
      form.setValue("assignee", user.name);
    }
  }, [user, hasActiveTeam, selectedAssigneeIds, onSelectAssignee, form]);

  // Reset selected IDs (e.g., when dialog closes)
  const resetAssignees = useCallback(() => {
    setSelectedAssigneeIds((prev) => (prev.length === 0 ? prev : []));
  }, []);

  /**
   * Initialize selected assignee IDs from an existing work item's assignee name.
   * Matches the `assignee` string field against available members by name.
   */
  const initFromAssigneeName = useCallback(
    (assigneeName: string | null | undefined) => {
      if (!assigneeName || availableAssignees.length === 0) {
        setSelectedAssigneeIds((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      const matched = availableAssignees.find(
        (u) => u.name.toLowerCase() === assigneeName.toLowerCase()
      );
      if (matched) {
        setSelectedAssigneeIds((prev) =>
          prev.length === 1 && prev[0] === matched.id ? prev : [matched.id]
        );
      } else {
        setSelectedAssigneeIds((prev) => (prev.length === 0 ? prev : []));
      }
    },
    [availableAssignees]
  );

  return {
    availableAssignees,
    hasActiveTeam,
    isLoadingAssignees: isLoading,
    selectedAssigneeIds,
    onSelectAssignee,
    onRemoveAssignee,
    handleAssignToMe,
    resetAssignees,
    initFromAssigneeName,
    currentUserName: user?.name ?? undefined,
  };
};
