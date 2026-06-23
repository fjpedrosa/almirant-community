import { describe, expect, test } from "bun:test";
import {
  buildDodHumanActionV2Patch,
  buildIntegrationRemediationPatches,
} from "./integration-batch-repository";
import type { DodHumanActionV2 } from "@almirant/shared";

describe("buildDodHumanActionV2Patch (schema_irreconcilable path)", () => {
  const basePayload: DodHumanActionV2 = {
    version: 1,
    diagnosis: "Two valid schemas for slack_mentions; operator must pick.",
    rootCause: "schema_irreconcilable",
    evidence: {
      conflictingFiles: [
        "backend/packages/database/src/schema/slack-mentions.ts",
      ],
      relatedFeatures: [],
    },
    options: [
      {
        id: "reimplement-against-main",
        title: "Re-implement the branch",
        summary: "Keep main, rewrite the branch",
        pros: ["Cheaper"],
        cons: ["~hours of rework"],
        impact: { affectedItems: ["S-22"], estimatedEffort: "medium", reversible: true },
        action: {
          type: "trigger-runner-fix-dod",
          payload: { integrationContext: {} },
        },
      },
    ],
  };

  test("sets the human-action gate flags", () => {
    const { patch } = buildDodHumanActionV2Patch(
      basePayload,
      new Date("2026-05-09T10:00:00.000Z"),
    );
    expect(patch.dod_human_action_required).toBe(true);
    expect(patch.dod_human_review_required).toBe(true);
    expect(patch.dod_auto_remediation_blocked).toBe(true);
  });

  test("embeds the v2 payload under dod_human_action_v2", () => {
    const { patch } = buildDodHumanActionV2Patch(
      basePayload,
      new Date("2026-05-09T10:00:00.000Z"),
    );
    expect(patch.dod_human_action_v2).toBeDefined();
    const v2 = patch.dod_human_action_v2 as DodHumanActionV2;
    expect(v2.diagnosis).toBe(basePayload.diagnosis);
    expect(v2.options).toHaveLength(1);
  });

  test("mirrors diagnosis into the legacy text fields for backwards compat", () => {
    const { patch } = buildDodHumanActionV2Patch(
      basePayload,
      new Date("2026-05-09T10:00:00.000Z"),
    );
    expect(patch.dod_human_action).toBe(basePayload.diagnosis);
    expect(patch.dod_human_review_reason).toBe(basePayload.diagnosis);
  });

  test("stamps generatedAt when not provided", () => {
    const now = new Date("2026-05-09T10:00:00.000Z");
    const { enriched } = buildDodHumanActionV2Patch(basePayload, now);
    expect(enriched.generatedAt).toBe(now.toISOString());
  });

  test("preserves generatedAt when the agent already set it", () => {
    const explicitTs = "2026-05-08T12:00:00.000Z";
    const { enriched } = buildDodHumanActionV2Patch(
      { ...basePayload, generatedAt: explicitTs },
      new Date("2026-05-09T10:00:00.000Z"),
    );
    expect(enriched.generatedAt).toBe(explicitTs);
  });
});

describe("buildIntegrationRemediationPatches (schema_obsolete_branch path)", () => {
  const args = {
    integrationContext: {
      groundTruthSchema: {
        file: "backend/packages/database/src/schema/slack-mentions.ts",
        columns: ["authorSlackUserId", "respondedAt"],
      },
    },
    failureReason: "Branch references mentionerSlackUserId; main uses authorSlackUserId.",
    triggeredBy: "release-integration" as const,
    now: new Date("2026-05-09T10:00:00.000Z"),
  };

  test("leaf patch marks dod_incompleted=true and clears dod_approved", () => {
    const { leafPatch } = buildIntegrationRemediationPatches(args);
    expect(leafPatch.dod_incompleted).toBe(true);
    expect(leafPatch.dod_approved).toBe(false);
  });

  test("leaf patch does NOT include human-action gate flags", () => {
    // This is the whole point of the refactor: schema_obsolete_branch must
    // NOT block the remediation pipeline. The absence of these keys is the
    // contract.
    const { leafPatch } = buildIntegrationRemediationPatches(args);
    expect(leafPatch.dod_human_action_required).toBeUndefined();
    expect(leafPatch.dod_human_review_required).toBeUndefined();
    expect(leafPatch.dod_auto_remediation_blocked).toBeUndefined();
  });

  test("leaf patch embeds integrationContext inside dod_report as parseable JSON", () => {
    const { leafPatch } = buildIntegrationRemediationPatches(args);
    expect(typeof leafPatch.dod_report).toBe("string");
    const parsed = JSON.parse(leafPatch.dod_report as string);
    expect(parsed.source).toBe("release-integration");
    expect(parsed.failureReason).toBe(args.failureReason);
    expect(parsed.integrationContext).toEqual(args.integrationContext);
    expect(typeof parsed.instructions).toBe("string");
    expect(parsed.instructions.length).toBeGreaterThan(0);
  });

  test("parent patch marks integration_remediation_in_progress with timestamps", () => {
    const { parentPatch } = buildIntegrationRemediationPatches(args);
    expect(parentPatch.integration_remediation_in_progress).toBe(true);
    expect(parentPatch.integration_remediation_started_at).toBe(args.now.toISOString());
    expect(parentPatch.integration_remediation_failure_reason).toBe(args.failureReason);
  });

  test("parent patch does NOT include human-action gate flags either", () => {
    const { parentPatch } = buildIntegrationRemediationPatches(args);
    expect(parentPatch.dod_human_action_required).toBeUndefined();
    expect(parentPatch.dod_auto_remediation_blocked).toBeUndefined();
  });
});
