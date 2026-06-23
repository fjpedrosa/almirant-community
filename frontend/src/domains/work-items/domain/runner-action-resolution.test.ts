import { describe, expect, it } from "bun:test";
import {
  resolveExternalValidationRequirement,
  resolveHumanActionRequirement,
  resolveManualImplementRunnerJob,
  shouldBlockManualImplementForDodHumanReview,
} from "./runner-action-resolution";
import type { WorkItemMetadata } from "./types";

const baseItem = (metadata: WorkItemMetadata = {}) => ({
  id: "work-1",
  metadata,
});

describe("resolveManualImplementRunnerJob", () => {
  it("routes Backlog DoD-incomplete work items to DoD remediation", () => {
    expect(
      resolveManualImplementRunnerJob({
        item: baseItem({
          dod_incompleted: true,
          dod_report: "Legacy route still renders UI.",
        }),
        columnRole: "backlog",
        columnName: "Backlog",
      }),
    ).toEqual({
      jobType: "implementation",
      skillName: "runner-fix-dod",
      promptTemplate: "runner-fix-dod",
      triggerType: "event",
      interactive: false,
    });
  });

  it("keeps normal implementation for non-Backlog DoD-incomplete work items", () => {
    expect(
      resolveManualImplementRunnerJob({
        item: baseItem({ dod_incompleted: true }),
        columnRole: "review",
        columnName: "To Review",
      }),
    ).toEqual({});
  });

  it("blocks manual automation when repeated DoD failures require human review", () => {
    expect(
      shouldBlockManualImplementForDodHumanReview({
        item: baseItem({
          dod_incompleted: true,
          dod_incompleted_count: 4,
        }),
        columnRole: "backlog",
        columnName: "Backlog",
      }),
    ).toBe(true);
  });

  it("does not block normal DoD remediation before the human-review threshold", () => {
    expect(
      shouldBlockManualImplementForDodHumanReview({
        item: baseItem({
          dod_incompleted: true,
          dod_incompleted_count: 3,
        }),
        columnRole: "backlog",
        columnName: "Backlog",
      }),
    ).toBe(false);
  });

  it("blocks manual automation when DoD remediation needs a broader human action", () => {
    expect(
      shouldBlockManualImplementForDodHumanReview({
        item: baseItem({
          dod_incompleted: true,
          dod_human_action_required: true,
          dod_human_action: "Aplicar la migración en el entorno aprobado por el equipo.",
        }),
        columnRole: "backlog",
        columnName: "Backlog",
      }),
    ).toBe(true);
  });

  it("blocks manual automation when an external validator is required", () => {
    expect(
      shouldBlockManualImplementForDodHumanReview({
        item: baseItem({
          dod_incompleted: true,
          dod_external_validation_required: true,
          dod_external_validation_tools: ["Google Rich Results Test"],
        }),
        columnRole: "backlog",
        columnName: "Backlog",
      }),
    ).toBe(true);
  });
});

describe("resolveHumanActionRequirement", () => {
  it("returns the explicit human action message for card tooltip rendering", () => {
    expect(
      resolveHumanActionRequirement({
        dod_human_action_required: true,
        dod_human_action: "Legal debe confirmar el texto final antes de cerrar la tarea.",
      }),
    ).toEqual({
      required: true,
      message: "Legal debe confirmar el texto final antes de cerrar la tarea.",
    });
  });

  it("falls back to the DoD report when the old human-review flag is present", () => {
    expect(
      resolveHumanActionRequirement({
        dod_human_review_required: true,
        dod_report: "Falta validación legal por una persona responsable.",
      }),
    ).toEqual({
      required: true,
      message: "Falta validación legal por una persona responsable.",
    });
  });

  it("returns a non-required state for normal DoD failures", () => {
    expect(
      resolveHumanActionRequirement({
        dod_incompleted: true,
        dod_report: "Añadir test unitario.",
      }),
    ).toEqual({
      required: false,
      message: null,
    });
  });
});

describe("resolveExternalValidationRequirement", () => {
  it("returns tools and reason for external validator badges", () => {
    expect(
      resolveExternalValidationRequirement({
        dod_external_validation_required: true,
        dod_external_validation_tools: ["Schema.org Validator", "Lighthouse"],
        dod_external_validation_reason: "Comprobar rich snippets en validador externo.",
      }),
    ).toEqual({
      required: true,
      tools: ["Schema.org Validator", "Lighthouse"],
      message: "Comprobar rich snippets en validador externo.",
    });
  });

  it("treats a comma-separated tools string as an external validation requirement", () => {
    expect(
      resolveExternalValidationRequirement({
        dod_external_validation_tools: "Lighthouse, axe",
      }),
    ).toEqual({
      required: true,
      tools: ["Lighthouse", "axe"],
      message: null,
    });
  });
});
