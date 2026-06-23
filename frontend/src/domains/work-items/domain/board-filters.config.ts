import type { DynamicFiltersConfig, FilterOption } from "@/domains/shared/domain/filter-types";

export type BoardFilterLabels = {
  priority: string;
  assignee: string;
  project: string;
  assigneePlaceholder: string;
  priorityUrgent: string;
  priorityHigh: string;
  priorityMedium: string;
  priorityLow: string;
};

export const createBoardFiltersConfig = (
  tags: FilterOption[],
  projects: FilterOption[],
  assignees: FilterOption[] = [],
  labels: BoardFilterLabels,
): DynamicFiltersConfig => {
  const priorityOptions: FilterOption[] = [
    { value: "urgent", label: labels.priorityUrgent },
    { value: "high", label: labels.priorityHigh },
    { value: "medium", label: labels.priorityMedium },
    { value: "low", label: labels.priorityLow },
  ];

  return {
    initialFilters: [],
    definitions: [
      {
        id: "priority",
        label: labels.priority,
        type: "select",
        operators: ["equals"],
        options: priorityOptions,
        group: "Item",
      },
      assignees.length > 0
        ? {
            id: "assignee",
            label: labels.assignee,
            type: "multi_select" as const,
            operators: ["in" as const],
            options: assignees,
            group: "Item",
          }
        : {
            id: "assignee",
            label: labels.assignee,
            type: "text" as const,
            operators: ["contains" as const],
            placeholder: labels.assigneePlaceholder,
            group: "Item",
          },
      ...(tags.length > 0
        ? [
            {
              id: "tagIds",
              label: "Tags",
              type: "multi_select" as const,
              operators: ["in" as const],
              options: tags,
              group: "Metadata",
            },
          ]
        : []),
      ...(projects.length > 0
        ? [
            {
              id: "projectId",
              label: labels.project,
              type: "select" as const,
              operators: ["equals" as const],
              options: projects,
              group: "Metadata",
            },
          ]
        : []),
      {
        id: "isBug",
        label: "Bugs",
        type: "boolean",
        operators: ["equals"],
        group: "Metadata",
      },
    ],
    searchPlaceholder: "Search by title or ID...",
  };
};
