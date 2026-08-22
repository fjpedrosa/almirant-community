type PlanReviewHydrationAdmission = {
  reviewJobId: string;
  planSha256: string;
  status: string;
  result: unknown;
};

const toPlanReviewHydrationStatus = (
  status: string,
): "pending_review" | "applying" | "completed" | "rejected" | "failed" => {
  if (status === "queued") return "pending_review";
  if (status === "applying") return "applying";
  if (status === "completed") return "completed";
  if (status === "rejected") return "rejected";
  return "failed";
};

const readCreatedItemIds = (result: unknown): string[] => {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const generated = (result as Record<string, unknown>).generated;
  if (typeof generated !== "object" || generated === null || Array.isArray(generated)) return [];
  const createdIds = (generated as Record<string, unknown>).createdIds;
  return Array.isArray(createdIds)
    ? createdIds.filter((id): id is string => typeof id === "string")
    : [];
};

export const planReviewHydrationResponse = (
  planningSessionId: string,
  admission: PlanReviewHydrationAdmission | null,
) => {
  if (!admission) {
    return {
      planningSessionId,
      reviewJobId: null,
      originalPlanSha256: null,
      status: "idle" as const,
      createdItemIds: [],
      error: null,
    };
  }

  const isPending = admission.status === "queued" || admission.status === "applying";

  return {
    planningSessionId,
    reviewJobId: isPending ? admission.reviewJobId : null,
    originalPlanSha256: admission.planSha256,
    status: toPlanReviewHydrationStatus(admission.status),
    createdItemIds: readCreatedItemIds(admission.result),
    error:
      admission.status === "rejected"
        ? "The plan review rejected this plan. Review the findings and retry."
        : admission.status === "failed"
          ? "The plan review failed before creating work items. Review the plan and retry."
          : null,
  };
};
