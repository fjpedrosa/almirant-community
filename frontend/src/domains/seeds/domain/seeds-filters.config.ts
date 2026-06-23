import type {
  DynamicFiltersConfig,
  FilterOption,
} from "@/domains/shared/domain/filter-types";

export type SeedsFilterTranslations = {
  priority: string;
  source: string;
  owner: string;
  project: string;
  tag: string;
  forIdeation: string;
  searchPlaceholder: string;
  groupSeed: string;
  groupMetadata: string;
  priorities: {
    urgent: string;
    high: string;
    medium: string;
    low: string;
  };
  sources: {
    manual: string;
    feedback: string;
    ai_generated: string;
    import: string;
  };
};

export const createSeedsFiltersConfig = (
  owners: FilterOption[],
  projects: FilterOption[],
  tags: FilterOption[],
  translations: SeedsFilterTranslations,
): DynamicFiltersConfig => {
  const priorityOptions: FilterOption[] = [
    { value: "urgent", label: translations.priorities.urgent },
    { value: "high", label: translations.priorities.high },
    { value: "medium", label: translations.priorities.medium },
    { value: "low", label: translations.priorities.low },
  ];

  const sourceOptions: FilterOption[] = [
    { value: "manual", label: translations.sources.manual },
    { value: "feedback", label: translations.sources.feedback },
    { value: "ai_generated", label: translations.sources.ai_generated },
    { value: "import", label: translations.sources.import },
  ];

  return {
    definitions: [
      {
        id: "priority",
        label: translations.priority,
        type: "select",
        operators: ["equals"],
        options: priorityOptions,
        group: translations.groupSeed,
      },
      {
        id: "source",
        label: translations.source,
        type: "select",
        operators: ["equals"],
        options: sourceOptions,
        group: translations.groupSeed,
      },
      ...(owners.length > 0
        ? [
            {
              id: "ownerUserId",
              label: translations.owner,
              type: "select" as const,
              operators: ["equals" as const],
              options: owners,
              group: translations.groupSeed,
            },
          ]
        : []),
      ...(projects.length > 0
        ? [
            {
              id: "projectId",
              label: translations.project,
              type: "select" as const,
              operators: ["equals" as const],
              options: projects,
              group: translations.groupMetadata,
            },
          ]
        : []),
      ...(tags.length > 0
        ? [
            {
              id: "tagId",
              label: translations.tag,
              type: "select" as const,
              operators: ["equals" as const],
              options: tags,
              group: translations.groupMetadata,
            },
          ]
        : []),
      {
        id: "selectedForIdeation",
        label: translations.forIdeation,
        type: "boolean",
        operators: ["equals"],
        group: translations.groupMetadata,
      },
    ],
    searchPlaceholder: translations.searchPlaceholder,
  };
};
