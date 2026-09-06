import {
  canonicalizePlanV1,
  MAX_NATIVE_PLAN_V1_OUTPUT_CHARS as MAX_NATIVE_PLAN_OUTPUT_CHARS,
  NATIVE_PLAN_V1_MARKER as NATIVE_PLAN_MARKER,
  parsePlanV1,
  type PlanV1,
} from "@almirant/shared";
import { isFeatureFlagEnabled } from "../../../../shared/services/posthog-service";

export {
  MAX_NATIVE_PLAN_V1_OUTPUT_CHARS as MAX_NATIVE_PLAN_OUTPUT_CHARS,
  NATIVE_PLAN_V1_MARKER as NATIVE_PLAN_MARKER,
} from "@almirant/shared";
const FLAG = "native-plan-generation-v1";

type ScopeInput = {
  workspaceId: string | null | undefined;
  sessionWorkspaceId: string | null | undefined;
  requestedByUserId: string | null | undefined;
  projectId: string | null | undefined;
  boardId: string | null | undefined;
};
export type NativePlanningSnapshot = {
  planningContract: "plan-v1";
  workspaceId: string;
  requestedByUserId: string;
  projectId: string;
  boardId: string;
};
type FlagEvaluator = typeof isFeatureFlagEnabled;

export const buildNativePlanningSnapshot = async (
  input: ScopeInput,
  evaluate: FlagEvaluator = isFeatureFlagEnabled,
): Promise<NativePlanningSnapshot | null> => {
  const { workspaceId, sessionWorkspaceId, requestedByUserId, projectId, boardId } = input;
  if (!workspaceId || workspaceId !== sessionWorkspaceId || !requestedByUserId || !projectId || !boardId) {
    return null;
  }
  try {
    if (!(await evaluate(FLAG, requestedByUserId, { groups: { workspace: workspaceId } }))) return null;
  } catch {
    return null;
  }
  return { planningContract: "plan-v1", workspaceId, requestedByUserId, projectId, boardId };
};

type NativePlanResult =
  | { status: "available"; plan: PlanV1; content: string; sha256: string }
  | { status: "not_found" | "invalid" | "too_large" };

export const parseNativePlanOutput = ({
  assistantText,
  target,
  truncated = false,
}: {
  assistantText: string;
  target: { projectId: string; boardId: string };
  truncated?: boolean;
}): NativePlanResult => {
  if (truncated || assistantText.length > MAX_NATIVE_PLAN_OUTPUT_CHARS) return { status: "too_large" };
  const text = assistantText.trim();
  if (!text) return { status: "not_found" };
  const markerPrefix = `${NATIVE_PLAN_MARKER}\n`;
  if (!text.startsWith(markerPrefix) || text.split(NATIVE_PLAN_MARKER).length !== 2) {
    return { status: text.includes(NATIVE_PLAN_MARKER) ? "invalid" : "not_found" };
  }
  try {
    const draft = JSON.parse(text.slice(markerPrefix.length));
    if (!draft || typeof draft !== "object" || Array.isArray(draft) || Object.hasOwn(draft, "target")) {
      return { status: "invalid" };
    }
    const plan = parsePlanV1({ ...draft, target });
    return { status: "available", plan, ...canonicalizePlanV1(plan) };
  } catch {
    return { status: "invalid" };
  }
};
