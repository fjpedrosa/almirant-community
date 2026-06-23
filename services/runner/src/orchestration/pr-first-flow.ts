import {
  resolvePostSessionPushPolicy,
  shouldSkipPrFirstFlow,
} from "./job-intent";

type PrFirstFlowInput = {
  jobType?: string | null;
  interactive?: boolean | null;
  skillName?: string | null;
  promptTemplate?: string | null;
  isPrewarm?: boolean | null;
  repoUrl?: string | null;
  config?: Record<string, unknown> | null;
};

export const shouldPreparePrFirstFlow = ({
  jobType,
  interactive,
  skillName,
  promptTemplate,
  isPrewarm,
  repoUrl,
  config,
}: PrFirstFlowInput): boolean => {
  if (!repoUrl) return false;
  if (
    shouldSkipPrFirstFlow({
      promptTemplate,
      skillName,
      jobType,
      interactive,
      config,
    })
  ) {
    return false;
  }
  return (
    resolvePostSessionPushPolicy({
      promptTemplate,
      skillName,
      jobType,
      interactive,
      config: isPrewarm === true ? { ...(config ?? {}), isPrewarm: true } : config,
    }) === "on-success"
  );
};
