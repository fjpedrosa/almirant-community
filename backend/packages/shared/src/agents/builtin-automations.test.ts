import { describe, expect, test } from "bun:test";
import {
  BUILTIN_AUTOMATION_IDS,
  BUILTIN_AUTOMATION_TARGET_CONFIG_KEYS,
  BUILTIN_AUTOMATIONS,
  BUILTIN_AUTOMATIONS_BY_ID,
  BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY,
  isBuiltinAutomationId,
  resolveEnabledBuiltinAutomation,
  type BuiltinAutomationId,
} from "./builtin-automations";

// ---------------------------------------------------------------------------
// Contract pin: this is the single source of truth for the four built-in
// scheduled-agent automation modes. These tests pin the EXACT shape and
// dispatch precedence already live in scheduled-agent-dispatcher.ts's
// if/else-if ladder (backlogDrain -> dodRemediation -> dodReview ->
// releaseIntegration) and the skill names hardcoded across the dispatcher +
// release-integration-queue-service.ts, BEFORE those call sites are
// refactored to consume this catalog. A change here that breaks one of these
// assertions is a behavior change, not a mechanical refactor.
// ---------------------------------------------------------------------------

describe("BUILTIN_AUTOMATIONS catalog", () => {
  test("has exactly the four known automations, in dispatch-precedence order", () => {
    expect(BUILTIN_AUTOMATION_IDS).toEqual([
      "backlog-drain",
      "dod-remediation",
      "dod-review",
      "release-integration",
    ]);
  });

  test("pins targetConfigKey per automation id", () => {
    expect(BUILTIN_AUTOMATIONS_BY_ID["backlog-drain"].targetConfigKey).toBe("backlogDrain");
    expect(BUILTIN_AUTOMATIONS_BY_ID["dod-remediation"].targetConfigKey).toBe("dodRemediation");
    expect(BUILTIN_AUTOMATIONS_BY_ID["dod-review"].targetConfigKey).toBe("dodReview");
    expect(BUILTIN_AUTOMATIONS_BY_ID["release-integration"].targetConfigKey).toBe(
      "releaseIntegration",
    );
  });

  test("pins jobType per automation — mirrors the createJob calls in the dispatcher", () => {
    expect(BUILTIN_AUTOMATIONS_BY_ID["backlog-drain"].jobType).toBe("implementation");
    expect(BUILTIN_AUTOMATIONS_BY_ID["dod-remediation"].jobType).toBe("implementation");
    expect(BUILTIN_AUTOMATIONS_BY_ID["dod-review"].jobType).toBe("review");
    expect(BUILTIN_AUTOMATIONS_BY_ID["release-integration"].jobType).toBe("integration");
  });

  test("pins the default skill name per automation — the literals hardcoded today", () => {
    expect(BUILTIN_AUTOMATIONS_BY_ID["backlog-drain"].skillName).toBe("runner-implement");
    // dod-remediation's default; executeDodRemediation still lets an
    // individual candidate override it via candidate.skillName.
    expect(BUILTIN_AUTOMATIONS_BY_ID["dod-remediation"].skillName).toBe("runner-fix-dod");
    expect(BUILTIN_AUTOMATIONS_BY_ID["dod-review"].skillName).toBe("dod-review");
    expect(BUILTIN_AUTOMATIONS_BY_ID["release-integration"].skillName).toBe(
      "runner-release-integration",
    );
  });

  test("dispatchPrecedence matches the array order and the existing if/else-if ladder", () => {
    const byPrecedence = [...BUILTIN_AUTOMATIONS].sort(
      (a, b) => a.dispatchPrecedence - b.dispatchPrecedence,
    );
    expect(byPrecedence.map((a) => a.id)).toEqual([...BUILTIN_AUTOMATION_IDS]);
  });

  test("BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY is keyed by targetConfigKey and round-trips", () => {
    for (const automation of BUILTIN_AUTOMATIONS) {
      expect(BUILTIN_AUTOMATIONS_BY_TARGET_CONFIG_KEY[automation.targetConfigKey]).toBe(automation);
    }
    expect(BUILTIN_AUTOMATION_TARGET_CONFIG_KEYS).toEqual([
      "backlogDrain",
      "dodRemediation",
      "dodReview",
      "releaseIntegration",
    ]);
  });

  test("each automation carries non-empty UI label/description metadata", () => {
    for (const automation of BUILTIN_AUTOMATIONS) {
      expect(automation.name.length).toBeGreaterThan(0);
      expect(automation.description.length).toBeGreaterThan(0);
    }
  });
});

describe("isBuiltinAutomationId", () => {
  test("accepts all four known ids", () => {
    for (const id of BUILTIN_AUTOMATION_IDS) {
      expect(isBuiltinAutomationId(id)).toBe(true);
    }
  });

  test("rejects unrelated strings and non-strings", () => {
    expect(isBuiltinAutomationId("not-a-real-automation")).toBe(false);
    expect(isBuiltinAutomationId("")).toBe(false);
    expect(isBuiltinAutomationId(undefined)).toBe(false);
    expect(isBuiltinAutomationId(null)).toBe(false);
    expect(isBuiltinAutomationId(42)).toBe(false);
  });
});

describe("resolveEnabledBuiltinAutomation", () => {
  test("returns undefined for an empty/undefined/null targetConfig", () => {
    expect(resolveEnabledBuiltinAutomation(undefined)).toBeUndefined();
    expect(resolveEnabledBuiltinAutomation(null)).toBeUndefined();
    expect(resolveEnabledBuiltinAutomation({})).toBeUndefined();
  });

  test("returns undefined when every flag is explicitly false or absent", () => {
    expect(
      resolveEnabledBuiltinAutomation({
        backlogDrain: { enabled: false },
        dodRemediation: null,
        dodReview: undefined,
        releaseIntegration: { enabled: false },
      }),
    ).toBeUndefined();
  });

  test("resolves the single enabled automation", () => {
    expect(resolveEnabledBuiltinAutomation({ dodReview: { enabled: true } })?.id).toBe("dod-review");
    expect(
      resolveEnabledBuiltinAutomation({ releaseIntegration: { enabled: true } })?.id,
    ).toBe("release-integration");
  });

  // -------------------------------------------------------------------------
  // Precedence ladder pin — mirrors scheduled-agent-dispatcher.ts's
  // dispatchOneConfig if/else-if chain EXACTLY. When multiple flags are
  // simultaneously true, the first branch in source order wins; this must
  // stay true after the router is rewritten to use this catalog.
  // -------------------------------------------------------------------------
  const allEnabled: Record<string, { enabled: boolean }> = {
    backlogDrain: { enabled: true },
    dodRemediation: { enabled: true },
    dodReview: { enabled: true },
    releaseIntegration: { enabled: true },
  };

  test("backlogDrain wins over every other flag when all four are enabled", () => {
    expect(resolveEnabledBuiltinAutomation(allEnabled)?.id).toBe("backlog-drain");
  });

  test("dodRemediation wins over dodReview/releaseIntegration when backlogDrain is off", () => {
    expect(
      resolveEnabledBuiltinAutomation({ ...allEnabled, backlogDrain: { enabled: false } })?.id,
    ).toBe("dod-remediation");
  });

  test("dodReview wins over releaseIntegration when backlogDrain/dodRemediation are off", () => {
    expect(
      resolveEnabledBuiltinAutomation({
        ...allEnabled,
        backlogDrain: { enabled: false },
        dodRemediation: { enabled: false },
      })?.id,
    ).toBe("dod-review");
  });

  test("releaseIntegration is the last resort when the other three are off", () => {
    expect(
      resolveEnabledBuiltinAutomation({
        ...allEnabled,
        backlogDrain: { enabled: false },
        dodRemediation: { enabled: false },
        dodReview: { enabled: false },
      })?.id,
    ).toBe("release-integration");
  });

  test("type narrows to BuiltinAutomationId on the returned definition's id", () => {
    const resolved = resolveEnabledBuiltinAutomation({ backlogDrain: { enabled: true } });
    const id: BuiltinAutomationId | undefined = resolved?.id;
    expect(id).toBe("backlog-drain");
  });
});
