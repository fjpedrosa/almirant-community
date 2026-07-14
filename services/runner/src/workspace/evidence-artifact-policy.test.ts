import { describe, expect, it } from "bun:test";
import type { EvidenceArtifactDescriptor } from "@almirant/shared";
import { resolveEvidenceArtifactsForJob } from "./evidence-artifact-policy";

const evidence: EvidenceArtifactDescriptor[] = [{
  artifactId: "00000000-0000-4000-8000-000000000001",
  sha256: "a".repeat(64),
  byteSize: 128,
  contentType: "image/png",
  localFilename: "desktop.png",
}];

const validConfig = (): Record<string, unknown> => ({
  evidenceArtifacts: evidence,
  siteBuildStage: "visual_judge",
  workspaceIntent: "read-only",
  postSessionPushPolicy: "never",
  needsBrowser: false,
  prompt: "Review the server-provided evidence.",
});

describe("resolveEvidenceArtifactsForJob", () => {
  it("allows verified evidence only as a sidecar to a git workspace", () => {
    expect(resolveEvidenceArtifactsForJob({
      config: validConfig(),
      workspaceKind: "git_repo",
    })).toEqual(evidence);
  });

  it("does nothing for ordinary jobs without evidence", () => {
    expect(resolveEvidenceArtifactsForJob({
      config: { prompt: "Normal job" },
      workspaceKind: "git_repo",
    })).toEqual([]);
  });

  it("fails closed when visual_judge omits or empties its server-owned evidence", () => {
    const visualJudgeConfig = {
      siteBuildStage: "visual_judge",
      workspaceIntent: "read-only",
      postSessionPushPolicy: "never",
      needsBrowser: false,
    };

    expect(() => resolveEvidenceArtifactsForJob({
      config: visualJudgeConfig,
      workspaceKind: "git_repo",
    })).toThrow(/requires between 1 and 9 evidence artifacts/i);

    expect(() => resolveEvidenceArtifactsForJob({
      config: { ...visualJudgeConfig, evidenceArtifacts: [] },
      workspaceKind: "git_repo",
    })).toThrow(/requires between 1 and 9 evidence artifacts/i);
  });

  it.each([
    ["cross-stage", { siteBuildStage: "implement" }],
    ["writable workspace", { workspaceIntent: "write" }],
    ["push enabled", { postSessionPushPolicy: "on-success" }],
    ["browser enabled", { needsBrowser: true }],
    ["implicit browser policy", { needsBrowser: undefined }],
    ["nested browser policy", { resourceProfile: { requiresBrowser: true } }],
  ])("fails closed for %s evidence config", (_label, override) => {
    expect(() => resolveEvidenceArtifactsForJob({
      config: { ...validConfig(), ...override },
      workspaceKind: "git_repo",
    })).toThrow("Evidence artifacts require");
  });

  it("rejects evidence that would replace rather than accompany the git repo", () => {
    expect(() => resolveEvidenceArtifactsForJob({
      config: validConfig(),
      workspaceKind: "uploaded_files",
    })).toThrow("git_repo");
  });

  it("ignores artifact IDs and paths embedded in prompt text", () => {
    const config = validConfig();
    config.prompt = "Use artifact attacker-id at /tmp/attacker.png";

    expect(resolveEvidenceArtifactsForJob({
      config,
      workspaceKind: "git_repo",
    })).toEqual(evidence);
  });
});
