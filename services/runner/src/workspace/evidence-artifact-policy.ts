import {
  parseEvidenceArtifacts,
  type EvidenceArtifactDescriptor,
} from "@almirant/shared";

const hasNestedBrowserRequirement = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.needsBrowser === true ||
    record.requiresBrowser === true ||
    record.enableBrowser === true;
};

const hasConflictingBrowserRequirement = (config: Record<string, unknown>): boolean =>
  config.requiresBrowser === true ||
  config.enableBrowser === true ||
  hasNestedBrowserRequirement(config.resourceProfile) ||
  hasNestedBrowserRequirement(config.resourceRequirements);

export const resolveEvidenceArtifactsForJob = ({
  config,
  workspaceKind,
}: {
  config: Record<string, unknown>;
  workspaceKind: string;
}): EvidenceArtifactDescriptor[] => {
  const isVisualJudge = config.siteBuildStage === "visual_judge";
  if (!isVisualJudge && config.evidenceArtifacts === undefined) return [];

  if (isVisualJudge && config.evidenceArtifacts === undefined) {
    throw new Error("visual_judge requires between 1 and 9 evidence artifacts");
  }
  if (isVisualJudge && Array.isArray(config.evidenceArtifacts) && config.evidenceArtifacts.length === 0) {
    throw new Error("visual_judge requires between 1 and 9 evidence artifacts");
  }

  if (!isVisualJudge) {
    throw new Error("Evidence artifacts require siteBuildStage=visual_judge");
  }
  if (workspaceKind !== "git_repo") {
    throw new Error("Evidence artifacts require a git_repo sidecar workspace");
  }
  if (config.workspaceIntent !== "read-only") {
    throw new Error("Evidence artifacts require workspaceIntent=read-only");
  }
  if (config.postSessionPushPolicy !== "never") {
    throw new Error("Evidence artifacts require postSessionPushPolicy=never");
  }
  if (config.needsBrowser !== false || hasConflictingBrowserRequirement(config)) {
    throw new Error("Evidence artifacts require needsBrowser=false explicitly");
  }

  const artifacts = parseEvidenceArtifacts(config.evidenceArtifacts);
  if (artifacts.length === 0) {
    throw new Error("visual_judge requires between 1 and 9 evidence artifacts");
  }
  return artifacts;
};
