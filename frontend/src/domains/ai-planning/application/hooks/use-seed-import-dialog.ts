"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSeeds } from "@/domains/planning/application/hooks/use-seeds-manager";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useTags } from "@/domains/tags/application/hooks/use-tags";
import { useDynamicFilters } from "@/domains/shared/application/hooks/use-dynamic-filters";
import type { SeedWithRelations } from "@/domains/planning/domain/types";
import type { DynamicFiltersConfig } from "@/domains/shared/domain/filter-types";
import type { SeedImportResult } from "../../domain/types";
import { buildSeedContextPrefix } from "../utils/build-seed-context";

// ---------------------------------------------------------------------------
// Hook: useSeedImportDialog
// ---------------------------------------------------------------------------

export type SeedImportDialogOptions = {
  defaultProjectId?: string;
  currentUserId?: string;
};

export const useSeedImportDialog = (
  onImportComplete?: (result: SeedImportResult) => void,
  options?: SeedImportDialogOptions,
) => {
  const t = useTranslations("aiPlanning.seedImport");

  // ----- Local state -----
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // ----- Options data -----
  const { members } = useTeamMembersSelect();
  const { data: projects = [] } = useProjects();
  const { data: allTags = [] } = useTags();

  // ----- Build initial filters from options -----
  const initialFilters = useMemo(() => {
    const filters: Array<{ fieldId: string; operator: "equals"; value: string }> = [];
    if (options?.defaultProjectId) {
      filters.push({ fieldId: "projectId", operator: "equals", value: options.defaultProjectId });
    }
    if (options?.currentUserId) {
      filters.push({ fieldId: "ownerUserId", operator: "equals", value: options.currentUserId });
    }
    return filters;
  }, [options?.defaultProjectId, options?.currentUserId]);

  // ----- Filter config (dynamic) -----
  const filtersConfig = useMemo<DynamicFiltersConfig>(() => ({
    definitions: [
      {
        id: "status",
        label: t("filterStatus"),
        type: "select" as const,
        operators: ["equals" as const],
        group: "Seed",
        options: [
          { value: "draft", label: t("statusLabel.draft") },
          { value: "active", label: t("statusLabel.active") },
          { value: "to_review", label: t("statusLabel.to_review") },
          { value: "approved", label: t("statusLabel.approved") },
          { value: "archived", label: t("statusLabel.archived") },
          { value: "rejected", label: t("statusLabel.rejected") },
        ],
      },
      {
        id: "source",
        label: t("filterSource"),
        type: "select" as const,
        operators: ["equals" as const],
        group: "Seed",
        options: [
          { value: "manual", label: t("sourceManual") },
          { value: "feedback", label: t("sourceFeedback") },
          { value: "ai_generated", label: t("sourceAi") },
          { value: "import", label: t("sourceImport") },
        ],
      },
      {
        id: "priority",
        label: t("filterPriority"),
        type: "select" as const,
        operators: ["equals" as const],
        group: "Seed",
        options: [
          { value: "low", label: t("priorityLow") },
          { value: "medium", label: t("priorityMedium") },
          { value: "high", label: t("priorityHigh") },
          { value: "urgent", label: t("priorityUrgent") },
        ],
      },
      ...(members.length > 0
        ? [{
            id: "ownerUserId",
            label: t("filterOwner"),
            type: "select" as const,
            operators: ["equals" as const],
            group: "Metadata",
            options: members.map((m) => ({ value: m.id, label: m.name || m.email })),
          }]
        : []),
      ...(projects.length > 0
        ? [{
            id: "projectId",
            label: t("filterProject"),
            type: "select" as const,
            operators: ["equals" as const],
            group: "Metadata",
            options: projects.map((p) => ({ value: p.id, label: p.name })),
          }]
        : []),
      ...(allTags.length > 0
        ? [{
            id: "tagId",
            label: t("filterTag"),
            type: "select" as const,
            operators: ["equals" as const],
            group: "Metadata",
            options: allTags.map((tag) => ({ value: tag.id, label: tag.name })),
          }]
        : []),
    ],
    initialFilters,
  }), [t, members, projects, allTags, initialFilters]);

  const dynamicFilters = useDynamicFilters(filtersConfig);

  // ----- Build server-side params from applied filters -----
  const serverParams = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    for (const filter of dynamicFilters.appliedFilters) {
      // Server-side filterable fields
      if (["status", "ownerUserId", "projectId", "tagId"].includes(filter.fieldId)) {
        params.set(filter.fieldId, String(filter.value));
      }
    }
    return params;
  }, [searchQuery, dynamicFilters.appliedFilters]);

  // ----- Fetch seeds (server-filtered) -----
  const { data: seeds = [], isLoading } = useSeeds(serverParams);

  // ----- Client-side filtering for source and priority -----
  const filteredSeeds = useMemo<SeedWithRelations[]>(() => {
    let result = seeds;
    for (const filter of dynamicFilters.appliedFilters) {
      if (filter.fieldId === "source") {
        result = result.filter((s) => s.source === filter.value);
      }
      if (filter.fieldId === "priority") {
        result = result.filter((s) => s.priority === filter.value);
      }
    }
    return result;
  }, [seeds, dynamicFilters.appliedFilters]);

  // ----- hasActiveFilters -----
  const hasActiveFilters =
    dynamicFilters.appliedFilters.length > 0 || searchQuery.trim().length > 0;

  // ----- Open / Close -----
  const open = useCallback(() => {
    setIsOpen(true);
    setSelectedIds(new Set());
    setSearchQuery("");
    dynamicFilters.clearFilters();
  }, [dynamicFilters]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // ----- Selection handlers -----
  const handleToggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filteredSeeds.map((s) => s.id)));
  }, [filteredSeeds]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // ----- Import -----
  const handleImport = useCallback(() => {
    const selected = seeds.filter((s) => selectedIds.has(s.id));
    const contextPrefix = buildSeedContextPrefix(selected);
    const result: SeedImportResult = { seeds: selected, contextPrefix };
    close();
    onImportComplete?.(result);
    return result;
  }, [seeds, selectedIds, close, onImportComplete]);

  // ----- Return -----
  return {
    isOpen,
    open,
    close,
    seeds: filteredSeeds,
    isLoading,
    selectedIds,
    selectedCount: selectedIds.size,
    searchQuery,
    setSearchQuery,
    handleToggle,
    handleSelectAll,
    handleDeselectAll,
    handleImport,
    // Dynamic filters (replaces individual filter props)
    filtersConfig,
    dynamicFilters,
    hasActiveFilters,
  };
};
