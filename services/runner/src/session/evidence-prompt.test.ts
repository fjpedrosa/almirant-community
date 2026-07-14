import { describe, expect, it } from "bun:test";
import { EVIDENCE_MANIFEST_PATH } from "../workspace/evidence-artifact-provisioner";
import { appendEvidenceManifestInstruction } from "./evidence-prompt";

describe("appendEvidenceManifestInstruction", () => {
  it("injects only the runner-owned deterministic manifest path", () => {
    const prompt = appendEvidenceManifestInstruction("Judge the design.", EVIDENCE_MANIFEST_PATH);

    expect(prompt).toContain(EVIDENCE_MANIFEST_PATH);
    expect(prompt).toContain("Read the manifest first");
    expect(prompt).toContain("Do not fetch replacement evidence from the network");
  });

  it("leaves ordinary prompts unchanged", () => {
    expect(appendEvidenceManifestInstruction("Normal job.", undefined)).toBe("Normal job.");
  });

  it("fails closed if any caller tries to inject an arbitrary manifest path", () => {
    expect(() => appendEvidenceManifestInstruction(
      "Judge the design.",
      "/tmp/attacker-controlled.json",
    )).toThrow("runner-owned evidence manifest path");
  });
});
