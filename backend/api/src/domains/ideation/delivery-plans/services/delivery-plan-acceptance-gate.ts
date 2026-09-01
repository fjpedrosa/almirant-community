import { assertNativePlanCompatibilityReady, type DeliveryAuthorityScope } from "@almirant/database";
import { isFeatureFlagEnabled } from "../../../../shared/services/posthog-service";

const ACCEPTANCE_FLAG = "delivery-plan-acceptance-v1";
type GateDependencies = {
  flagEnabled: (flag: string, workspaceId: string) => Promise<boolean>;
  assertReady: (scope: DeliveryAuthorityScope) => Promise<void>;
};

export class DeliveryPlanAcceptanceGateError extends Error {
  constructor() { super("acceptance_unavailable"); this.name = "DeliveryPlanAcceptanceGateError"; }
}

export const assertDeliveryPlanAcceptanceEnabled = async (
  scope: DeliveryAuthorityScope,
  dependencies: GateDependencies = {
    flagEnabled: (flag, workspaceId) => isFeatureFlagEnabled(flag, workspaceId, { groups: { workspace: workspaceId } }),
    assertReady: assertNativePlanCompatibilityReady,
  },
): Promise<void> => {
  try {
    if (!await dependencies.flagEnabled(ACCEPTANCE_FLAG, scope.workspaceId)) throw new Error("disabled");
    await dependencies.assertReady(scope);
  } catch {
    throw new DeliveryPlanAcceptanceGateError();
  }
};
