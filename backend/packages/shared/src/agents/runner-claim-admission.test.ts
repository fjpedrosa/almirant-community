import { describe, expect, test } from "bun:test";
import { runtimeCapabilityProjection } from "./runtime-capability-projection.generated";
import {
  LEGACY_CLAIMABLE_CODING_AGENTS,
  resolveClaimCodingAgentAdmission,
} from "./runner-claim-admission";

const currentIdentity = {
  schemaVersion: runtimeCapabilityProjection.schemaVersion,
  version: runtimeCapabilityProjection.version,
  hash: runtimeCapabilityProjection.hash,
};

const expectEffectiveAgents = (
  acceptedCodingAgents?: readonly string[],
  runtimeCapabilityIdentity?: {
    schemaVersion?: string;
    version?: number;
    hash?: string;
  },
): readonly string[] => {
  const admission = resolveClaimCodingAgentAdmission({
    acceptedCodingAgents,
    runtimeCapabilityIdentity,
  });
  expect(admission.admitted).toBe(true);
  if (!admission.admitted) throw new Error(`unexpected rejection: ${admission.code}`);
  return admission.effectiveCodingAgents;
};

describe("resolveClaimCodingAgentAdmission", () => {
  test("keeps missing and empty advertisements on the exact legacy claim set", () => {
    expect(LEGACY_CLAIMABLE_CODING_AGENTS).toEqual([
      "claude-code",
      "codex",
      "opencode",
    ]);
    expect(expectEffectiveAgents()).toEqual(LEGACY_CLAIMABLE_CODING_AGENTS);
    expect(expectEffectiveAgents([])).toEqual(LEGACY_CLAIMABLE_CODING_AGENTS);
  });

  test("narrows explicit legacy advertisements without requiring registry identity", () => {
    expect(expectEffectiveAgents(["codex"])).toEqual(["codex"]);
    expect(
      expectEffectiveAgents(["claude-code"], {
        schemaVersion: "stale-schema",
        version: -1,
        hash: "sha256:stale",
      }),
    ).toEqual(["claude-code"]);
  });

  test("admits Pi only from an explicit advertisement with current identity", () => {
    expect(expectEffectiveAgents(["pi"], currentIdentity)).toEqual(["pi"]);
    expect(expectEffectiveAgents(["claude-code", "pi"], currentIdentity)).toEqual([
      "claude-code",
      "pi",
    ]);
    expect(expectEffectiveAgents()).not.toContain("pi");
    expect(expectEffectiveAgents([])).not.toContain("pi");
  });

  test("projects only the exact Pi Z.AI GLM-5.3 API-key tuple as claimable", () => {
    const piTuples = runtimeCapabilityProjection.tuples.filter(
      (tuple) => tuple.codingAgent === "pi",
    );
    const enabledPiTuples = piTuples.filter((tuple) => tuple.admissionEnabled);

    expect(enabledPiTuples).toEqual([
      expect.objectContaining({
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        authClasses: ["api_key"],
        admissionEnabled: true,
        runtimeVerified: true,
        rejectionCode: null,
      }),
    ]);
    expect(
      piTuples
        .filter((tuple) => tuple !== enabledPiTuples[0])
        .every(
          (tuple) =>
            tuple.admissionEnabled === false && tuple.rejectionCode !== null,
        ),
    ).toBe(true);
  });

  test("keeps explicit unknown-only advertisements empty and never widens them", () => {
    expect(expectEffectiveAgents(["future-agent"])).toEqual([]);
    expect(expectEffectiveAgents(["future-agent", "codex", "future-agent", "codex"])).toEqual([
      "codex",
    ]);
  });

  test("deduplicates known agents in canonical deterministic order", () => {
    expect(
      expectEffectiveAgents([
        "opencode",
        "codex",
        "unknown",
        "claude-code",
        "codex",
        "opencode",
      ]),
    ).toEqual(["claude-code", "codex", "opencode"]);
  });

  test("requires complete current projection identity whenever Pi is advertised", () => {
    const missingIdentity = resolveClaimCodingAgentAdmission({
      acceptedCodingAgents: ["pi"],
    });
    expect(missingIdentity).toEqual({
      admitted: false,
      code: "RUNNER_RUNTIME_CAPABILITY_IDENTITY_REQUIRED",
    });

    for (const runtimeCapabilityIdentity of [
      { version: currentIdentity.version, hash: currentIdentity.hash },
      { schemaVersion: currentIdentity.schemaVersion, hash: currentIdentity.hash },
      { schemaVersion: currentIdentity.schemaVersion, version: currentIdentity.version },
    ]) {
      expect(
        resolveClaimCodingAgentAdmission({
          acceptedCodingAgents: ["claude-code", "pi"],
          runtimeCapabilityIdentity,
        }),
      ).toEqual({
        admitted: false,
        code: "RUNNER_RUNTIME_CAPABILITY_IDENTITY_REQUIRED",
      });
    }
  });

  test("rejects stale Pi schema, version, or hash identity", () => {
    for (const runtimeCapabilityIdentity of [
      { ...currentIdentity, schemaVersion: "runtime-capability-projection-v0" },
      { ...currentIdentity, version: currentIdentity.version + 1 },
      { ...currentIdentity, hash: "sha256:stale" },
    ]) {
      expect(
        resolveClaimCodingAgentAdmission({
          acceptedCodingAgents: ["pi"],
          runtimeCapabilityIdentity,
        }),
      ).toEqual({
        admitted: false,
        code: "RUNNER_RUNTIME_CAPABILITY_IDENTITY_MISMATCH",
      });
    }
  });
});
