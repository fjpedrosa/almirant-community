import { randomUUID } from "node:crypto";
import {
  admitPlanReviewWithJob,
  listConnections,
  type ProviderConnection,
} from "@almirant/database";
import {
  buildSkippedPlanReviewResult,
  canonicalizePlanReviewPlan,
  createPlanReviewCapabilityRef,
  getAgentModels,
  normalizeAgentModel,
  planReviewJobSnapshotSchema,
  planReviewPolicySchema,
  resolvePlanReviewSynthesizer,
  resolvePlanReviewCritics,
  type PlanReviewCapabilityCandidate,
  type PlanReviewCapabilityOption,
  type PlanReviewJobSnapshotV2,
  type PlanReviewProvider,
  type PlanReviewRuntime,
  type PlanReviewStructuredPlan,
} from "@almirant/shared";
import { generateWorkItems, aiWorkItemsPayloadSchema } from "../../shared/services/work-item-generator";

export const planReviewRequestSchema = planReviewPolicySchema;

type PlanReviewConnection = Pick<
  ProviderConnection,
  "id" | "name" | "provider" | "config" | "suspendedAt" | "isActive"
>;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Resolve a critic candidate's dedicated Plan Review model only. */
const getConfiguredCriticModel = (connection: PlanReviewConnection): string | null => {
  const config = asRecord(connection.config);
  const configured = config.planReviewModel;
  return normalizeAgentModel(
    String(connection.provider),
    typeof configured === "string" ? configured : null,
  );
};

const asPlanReviewProvider = (provider: string): PlanReviewProvider | null =>
  provider === "anthropic" || provider === "openai" || provider === "google" || provider === "zai" || provider === "xai"
    ? provider
    : null;

const runtimeForProvider = (): PlanReviewRuntime => "opencode";

const agentProviderForRuntime = (runtime: PlanReviewRuntime): "claude-code" | "codex" | "zipu" | "grok" =>
  runtime === "claude-code" ? "claude-code" : runtime === "codex" ? "codex" : "zipu";

const capabilityCandidates = (
  connections: PlanReviewConnection[],
  workspaceId: string,
  userId: string,
): PlanReviewCapabilityCandidate[] => connections
  .filter((connection) => connection.isActive && connection.suspendedAt === null)
  .flatMap((connection) => {
    const provider = asPlanReviewProvider(String(connection.provider));
    const model = getConfiguredCriticModel(connection);
    if (!provider) return [];
    return [{
      provider,
      connectionRef: createPlanReviewCapabilityRef({
        workspaceId,
        userId,
        connectionId: connection.id,
        provider,
      }),
      model,
      runtime: runtimeForProvider(),
      supportsIndependentCritics: true,
      maxIndependentCritics: 4,
    }];
  });

const capabilityOptions = (
  connections: PlanReviewConnection[],
  workspaceId: string,
  userId: string,
): PlanReviewCapabilityOption[] => {
  const seen = new Set<string>();
  return connections
    .filter((connection) => connection.isActive && connection.suspendedAt === null)
    .flatMap((connection) => {
      const provider = asPlanReviewProvider(String(connection.provider));
      if (!provider) return [];
      const connectionRef = createPlanReviewCapabilityRef({
        workspaceId,
        userId,
        connectionId: connection.id,
        provider,
      });
      if (seen.has(connectionRef)) return [];
      seen.add(connectionRef);
      return [{
        connectionRef,
        name: connection.name,
        provider,
        models: getAgentModels(provider),
      }];
    });
};

export type CreatePlanReviewAdmissionInput = {
  workspaceId: string;
  userId: string;
  planningSessionId: string;
  plan: PlanReviewStructuredPlan;
  policy: unknown;
};

export type PlanReviewAdmission = {
  jobId: string;
  snapshot: PlanReviewJobSnapshotV2;
  resolution: PlanReviewJobSnapshotV2["resolution"];
  status: "queued" | "applying" | "completed" | "rejected" | "failed";
  result: Record<string, unknown> | null;
  created: boolean;
};

export type PlanReviewAdmissionDependencies = {
  admitPlanReviewWithJob: typeof admitPlanReviewWithJob;
  listConnections: typeof listConnections;
  generateWorkItems: typeof generateWorkItems;
};

const defaultPlanReviewAdmissionDependencies: PlanReviewAdmissionDependencies = {
  admitPlanReviewWithJob,
  listConnections,
  generateWorkItems,
};

export const listPlanReviewCapabilities = async (
  input: { workspaceId: string; userId: string },
  dependencies: Pick<PlanReviewAdmissionDependencies, "listConnections"> = defaultPlanReviewAdmissionDependencies,
): Promise<PlanReviewCapabilityOption[]> => {
  const [workspaceConnections, userConnections] = await Promise.all([
    dependencies.listConnections({ scope: "organization", scopeId: input.workspaceId, category: "ai", isActive: true }),
    dependencies.listConnections({ scope: "user", scopeId: input.userId, category: "ai", isActive: true }),
  ]);
  return capabilityOptions([...workspaceConnections, ...userConnections], input.workspaceId, input.userId);
};

export const admitPlanReviewJob = async (
  input: CreatePlanReviewAdmissionInput,
  dependencies: PlanReviewAdmissionDependencies = defaultPlanReviewAdmissionDependencies,
): Promise<PlanReviewAdmission | null> => {
  const parsedPolicy = planReviewRequestSchema.parse(input.policy);
  if (!parsedPolicy.enabled) return null;

  const originalPlan = canonicalizePlanReviewPlan(input.plan);
  const reviewJobId = randomUUID();
  const [workspaceConnections, userConnections] = await Promise.all([
    dependencies.listConnections({ scope: "organization", scopeId: input.workspaceId, category: "ai", isActive: true }),
    dependencies.listConnections({ scope: "user", scopeId: input.userId, category: "ai", isActive: true }),
  ]);
  const candidates = capabilityCandidates(
    [...workspaceConnections, ...userConnections],
    input.workspaceId,
    input.userId,
  );
  const synthesizerResolution = resolvePlanReviewSynthesizer({
    requestedConnectionRef: parsedPolicy.synthesizerConnectionRef,
    requestedModel: parsedPolicy.synthesizerModel,
    candidates,
  });
  const criticCandidates = candidates.filter(
    (candidate) => candidate.connectionRef !== parsedPolicy.synthesizerConnectionRef,
  );
  const criticResolution = resolvePlanReviewCritics({
    workspaceId: input.workspaceId,
    userId: input.userId,
    reviewJobId,
    requestedCriticCount: parsedPolicy.requestedCriticCount,
    candidates: criticCandidates,
  });
  const resolution = synthesizerResolution.synthesizer === null
    ? {
        status: "skipped" as const,
        degradation: {
          status: "skipped_unavailable" as const,
          reason: synthesizerResolution.reason,
        },
      }
    : criticResolution.resolution;
  const critics = resolution.status === "skipped" ? [] : criticResolution.critics;
  const synthesizer = resolution.status === "skipped" ? null : synthesizerResolution.synthesizer;

  const snapshot: PlanReviewJobSnapshotV2 = {
    version: 2,
    intent: "plan-review",
    reviewJobId,
    enabled: true,
    originalPlan,
    requestedCriticCount: parsedPolicy.requestedCriticCount,
    maxRevisions: 1,
    synthesizer,
    critics,
    resolution,
  };
  const validatedSnapshot = planReviewJobSnapshotSchema.parse(snapshot);
  const originalPayload = aiWorkItemsPayloadSchema.parse(JSON.parse(originalPlan.content));
  const skipped = resolution.status === "skipped";
  const primary = critics[0];
  const skippedResult = skipped
    ? buildSkippedPlanReviewResult(reviewJobId, validatedSnapshot, resolution.degradation.reason)
    : null;

  const admission = await dependencies.admitPlanReviewWithJob({
    workspaceId: input.workspaceId,
    planningSessionId: input.planningSessionId,
    requestedByUserId: input.userId,
    projectId: input.plan.projectId,
    boardId: input.plan.boardId,
    boardColumnId: input.plan.boardColumnId,
    planSha256: originalPlan.sha256,
    snapshot: validatedSnapshot,
    reviewJobId,
    job: {
      workspaceId: input.workspaceId,
      projectId: input.plan.projectId,
      boardId: input.plan.boardId,
      planningSessionId: input.planningSessionId,
      createdByUserId: input.userId,
      jobType: "review",
      prompt: "plan-review",
      provider: skipped ? "zipu" : agentProviderForRuntime(primary!.runtime),
      codingAgent: skipped ? "opencode" : primary!.runtime,
      aiProvider: skipped ? "zai" : primary!.provider,
      model: skipped ? "plan-review-skipped" : primary!.model,
      status: skipped ? "completed" : "queued",
      result: skippedResult ? { planReviewOutput: skippedResult } : undefined,
      interactive: false,
      config: {
        repoPath: "",
        baseBranch: "",
        workspaceIntent: "read-only",
        sessionMode: "review",
        requestedByUserId: input.userId,
        planningSessionId: input.planningSessionId,
        providerConnectionId: skipped ? undefined : primary?.connectionRef,
        planReview: validatedSnapshot,
      },
    },
    onCreated: skipped
      ? async (tx) => {
          const generated = await dependencies.generateWorkItems({
            workspaceId: input.workspaceId,
            items: originalPayload.items,
            dependencies: originalPayload.dependencies,
            projectId: input.plan.projectId,
            boardId: input.plan.boardId,
            boardColumnId: input.plan.boardColumnId,
            atomic: true,
            executor: tx,
          });
          if (generated.errors.length > 0 || generated.dependencyErrors.length > 0) {
            throw new Error("Skipped plan review could not be applied completely.");
          }
          return { status: "completed" as const, result: { output: skippedResult!, generated } };
        }
      : undefined,
  });

  const storedSnapshot = planReviewJobSnapshotSchema.parse(admission.admission.snapshot);
  return {
    jobId: admission.admission.reviewJobId,
    snapshot: storedSnapshot,
    resolution: storedSnapshot.resolution,
    status: admission.admission.status as PlanReviewAdmission["status"],
    result: (admission.admission.result as Record<string, unknown> | null) ?? null,
    created: admission.created,
  };
};
