import { runtimeCapabilityProjection } from "./runtime-capability-projection.generated";

export const LEGACY_CLAIMABLE_CODING_AGENTS = [
  "claude-code",
  "codex",
  "opencode",
] as const;

export type ClaimableCodingAgent =
  (typeof runtimeCapabilityProjection.codingAgents)[number];

export interface RuntimeCapabilityIdentityAdvertisement {
  readonly schemaVersion?: string;
  readonly version?: number;
  readonly hash?: string;
}

export interface ClaimCodingAgentAdmissionRequest {
  readonly acceptedCodingAgents?: readonly string[];
  readonly runtimeCapabilityIdentity?: RuntimeCapabilityIdentityAdvertisement;
}

export type ClaimCodingAgentAdmissionRejectionCode =
  | "RUNNER_RUNTIME_CAPABILITY_IDENTITY_REQUIRED"
  | "RUNNER_RUNTIME_CAPABILITY_IDENTITY_MISMATCH";

export type ClaimCodingAgentAdmission =
  | {
      readonly admitted: true;
      readonly effectiveCodingAgents: readonly ClaimableCodingAgent[];
    }
  | {
      readonly admitted: false;
      readonly code: ClaimCodingAgentAdmissionRejectionCode;
    };

const admissionEnabledCodingAgents = new Set<ClaimableCodingAgent>(
  runtimeCapabilityProjection.tuples
    .filter((tuple) => tuple.admissionEnabled)
    .map((tuple) => tuple.codingAgent),
);

const hasCompleteIdentity = (
  identity: RuntimeCapabilityIdentityAdvertisement | undefined,
): identity is Required<RuntimeCapabilityIdentityAdvertisement> =>
  identity?.schemaVersion !== undefined &&
  identity.version !== undefined &&
  identity.hash !== undefined;

/**
 * Resolve a runner's coding-agent advertisement into the exact database claim
 * allowlist. Missing and empty advertisements preserve only the legacy fleet;
 * explicit advertisements never widen because of unknown entries.
 */
export const resolveClaimCodingAgentAdmission = (
  request: ClaimCodingAgentAdmissionRequest,
): ClaimCodingAgentAdmission => {
  const advertisedCodingAgents = request.acceptedCodingAgents;
  if (advertisedCodingAgents?.includes("pi")) {
    if (!hasCompleteIdentity(request.runtimeCapabilityIdentity)) {
      return {
        admitted: false,
        code: "RUNNER_RUNTIME_CAPABILITY_IDENTITY_REQUIRED",
      };
    }

    const { schemaVersion, version, hash } = request.runtimeCapabilityIdentity;
    if (
      schemaVersion !== runtimeCapabilityProjection.schemaVersion ||
      version !== runtimeCapabilityProjection.version ||
      hash !== runtimeCapabilityProjection.hash
    ) {
      return {
        admitted: false,
        code: "RUNNER_RUNTIME_CAPABILITY_IDENTITY_MISMATCH",
      };
    }
  }

  if (!advertisedCodingAgents || advertisedCodingAgents.length === 0) {
    return {
      admitted: true,
      effectiveCodingAgents: LEGACY_CLAIMABLE_CODING_AGENTS,
    };
  }

  const advertised = new Set(advertisedCodingAgents);
  const effectiveCodingAgents = runtimeCapabilityProjection.codingAgents.filter(
    (codingAgent) =>
      advertised.has(codingAgent) && admissionEnabledCodingAgents.has(codingAgent),
  );

  return { admitted: true, effectiveCodingAgents };
};
