import type { RuntimeExecutor } from "../shared/types";
import { CLAUDE_RUNTIME_SKILL_MARKER } from "../runtime-executors/claude";
import { createRuntimeExecutorRegistry } from "../runtime-executors/registry";

const runtimeExecutorRegistry = createRuntimeExecutorRegistry();

export const buildRuntimeSkillAugmentation = (params: {
  skillName: string;
  runtimeType: string;
}): string | null => {
  const executor = runtimeExecutorRegistry.resolveByRuntimeType(
    params.runtimeType as RuntimeExecutor["runtimeType"],
  );
  return executor.buildSkillAugmentation?.(params.skillName) ?? null;
};

export const augmentSkillContentForRuntime = (params: {
  skillName: string;
  runtimeExecutor?: RuntimeExecutor;
  runtimeType?: string;
  content: string;
}): { content: string; applied: boolean } => {
  const runtimeExecutor =
    params.runtimeExecutor ??
    runtimeExecutorRegistry.resolveByRuntimeType(
      (params.runtimeType ?? "opencode") as RuntimeExecutor["runtimeType"],
    );
  const augmentation =
    runtimeExecutor.buildSkillAugmentation?.(params.skillName) ?? null;
  if (!augmentation || params.content.includes(CLAUDE_RUNTIME_SKILL_MARKER)) {
    return { content: params.content, applied: false };
  }

  return {
    content: `${params.content.trimEnd()}\n\n${augmentation}\n`,
    applied: true,
  };
};

export { CLAUDE_RUNTIME_SKILL_MARKER as RUNTIME_SKILL_MCP_FALLBACK_MARKER };
