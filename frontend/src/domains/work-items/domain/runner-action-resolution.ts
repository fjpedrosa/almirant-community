import type {
  AgentJobType,
  RunnerSkillName,
  TriggerType,
} from "@/domains/agents/domain/types";
import type { ColumnRole } from "@/domains/boards/domain/types";
import type { WorkItemMetadata } from "./types";

type ManualImplementItem = {
  metadata?: WorkItemMetadata | Record<string, unknown> | null;
};

export type ManualImplementRunnerJobOverride = Partial<{
  jobType: AgentJobType;
  skillName: RunnerSkillName;
  promptTemplate: string;
  triggerType: TriggerType;
  interactive: boolean;
}>;

const isBacklogColumn = (
  columnRole: ColumnRole | null | undefined,
  columnName: string | null | undefined,
): boolean => {
  if (columnRole === "backlog") return true;
  return typeof columnName === "string" && columnName.toLowerCase().includes("backlog");
};

const isDodIncomplete = (metadata: ManualImplementItem["metadata"]): boolean => {
  return metadata?.dod_incompleted === true;
};

const getDodIncompleteCount = (metadata: ManualImplementItem["metadata"]): number => {
  const value = metadata?.dod_incompleted_count;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  }
  return 0;
};

const getFirstNonEmptyString = (
  metadata: ManualImplementItem["metadata"],
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const getStringListMetadata = (
  metadata: ManualImplementItem["metadata"],
  key: string,
): string[] => {
  const value = metadata?.[key];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

export type HumanActionRequirement = {
  required: boolean;
  message: string | null;
};

export type ExternalValidationRequirement = {
  required: boolean;
  message: string | null;
  tools: string[];
};

export const resolveExternalValidationRequirement = (
  metadata: ManualImplementItem["metadata"],
): ExternalValidationRequirement => {
  const tools = getStringListMetadata(metadata, "dod_external_validation_tools");
  const required = metadata?.dod_external_validation_required === true || tools.length > 0;

  if (!required) {
    return { required: false, message: null, tools: [] };
  }

  return {
    required: true,
    tools,
    message:
      getFirstNonEmptyString(metadata, [
        "dod_external_validation_reason",
        "dod_human_action",
        "dod_human_action_reason",
        "dod_human_review_reason",
        "validationChecks",
        "dod_report",
      ]) ?? null,
  };
};

export const resolveHumanActionRequirement = (
  metadata: ManualImplementItem["metadata"],
): HumanActionRequirement => {
  const required =
    metadata?.dod_human_action_required === true ||
    metadata?.dod_human_review_required === true ||
    metadata?.dod_auto_remediation_blocked === true ||
    resolveExternalValidationRequirement(metadata).required;

  if (!required) {
    return { required: false, message: null };
  }

  return {
    required: true,
    message:
      getFirstNonEmptyString(metadata, [
        "dod_human_action",
        "dod_human_action_reason",
        "dod_human_review_reason",
        "dod_external_validation_reason",
        "userActions",
        "dod_report",
      ]) ?? null,
  };
};

const requiresHumanDodReview = (metadata: ManualImplementItem["metadata"]): boolean => {
  return (
    resolveHumanActionRequirement(metadata).required ||
    getDodIncompleteCount(metadata) > 3
  );
};

export const shouldBlockManualImplementForDodHumanReview = (params: {
  item: ManualImplementItem | null | undefined;
  columnRole?: ColumnRole | null;
  columnName?: string | null;
}): boolean => {
  return Boolean(
    params.item &&
      isBacklogColumn(params.columnRole, params.columnName) &&
      isDodIncomplete(params.item.metadata) &&
      requiresHumanDodReview(params.item.metadata),
  );
};

export const resolveManualImplementRunnerJob = (params: {
  item: ManualImplementItem | null | undefined;
  columnRole?: ColumnRole | null;
  columnName?: string | null;
}): ManualImplementRunnerJobOverride => {
  if (
    params.item &&
    isBacklogColumn(params.columnRole, params.columnName) &&
    isDodIncomplete(params.item.metadata)
  ) {
    return {
      jobType: "implementation",
      skillName: "runner-fix-dod",
      promptTemplate: "runner-fix-dod",
      triggerType: "event",
      interactive: false,
    };
  }

  return {};
};
