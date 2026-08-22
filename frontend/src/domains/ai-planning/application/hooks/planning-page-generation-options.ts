import type { UsePlanningSessionReturn } from "@/domains/planning/application/hooks/use-planning-session";

export const buildPlanningPageGenerationOptions = (
  session: Pick<UsePlanningSessionReturn, "sessionId" | "planReview" | "setPlanReviewState">,
) => ({
  createdItemIds: session.planReview.createdItemIds,
  planReviewState: session.planReview,
  onPlanReviewStateChange: session.setPlanReviewState,
  planningSessionId: session.sessionId,
});
