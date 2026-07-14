import { describe, expect, it } from "bun:test";
import {
  EVIDENCE_ARTIFACT_LIMITS,
  parseEvidenceArtifacts,
  type EvidenceArtifactDescriptor,
} from "./evidence-artifacts";

const artifact = (
  overrides: Partial<EvidenceArtifactDescriptor> = {},
): EvidenceArtifactDescriptor => ({
  artifactId: "00000000-0000-4000-8000-000000000001",
  sha256: "a".repeat(64),
  byteSize: 128,
  contentType: "image/png",
  localFilename: "desktop.png",
  ...overrides,
});

describe("parseEvidenceArtifacts", () => {
  it("accepts the supported raster contract", () => {
    expect(parseEvidenceArtifacts([
      artifact(),
      artifact({
        artifactId: "00000000-0000-4000-8000-000000000002",
        contentType: "image/jpeg",
        localFilename: "mobile.jpg",
      }),
      artifact({
        artifactId: "00000000-0000-4000-8000-000000000003",
        contentType: "image/webp",
        localFilename: "tablet.webp",
      }),
    ])).toHaveLength(3);
  });

  it("rejects URL/blob fields and unsafe local filenames", () => {
    expect(() => parseEvidenceArtifacts([{
      ...artifact(),
      url: "https://attacker.invalid/evidence.png",
    }])).toThrow();
    expect(() => parseEvidenceArtifacts([{
      ...artifact(),
      contentBase64: "AAAA",
    }])).toThrow();
    expect(() => parseEvidenceArtifacts([artifact({ localFilename: "../desktop.png" })]))
      .toThrow("localFilename");
    expect(() => parseEvidenceArtifacts([artifact({ localFilename: "nested/desktop.png" })]))
      .toThrow("localFilename");
  });

  it("rejects duplicate artifact IDs and case-insensitive local filenames", () => {
    expect(() => parseEvidenceArtifacts([
      artifact(),
      artifact({ localFilename: "mobile.png" }),
    ])).toThrow("artifactId");

    expect(() => parseEvidenceArtifacts([
      artifact(),
      artifact({
        artifactId: "00000000-0000-4000-8000-000000000002",
        localFilename: "DESKTOP.PNG",
      }),
    ])).toThrow("localFilename");
  });

  it("enforces per-artifact, total-byte and artifact-count caps", () => {
    expect(() => parseEvidenceArtifacts([
      artifact({ byteSize: EVIDENCE_ARTIFACT_LIMITS.maxArtifactBytes + 1 }),
    ])).toThrow();

    const overTotal = Array.from({ length: 4 }, (_, index) => artifact({
      artifactId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      byteSize: EVIDENCE_ARTIFACT_LIMITS.maxTotalBytes / 3,
      localFilename: `viewport-${index}.png`,
    }));
    expect(() => parseEvidenceArtifacts(overTotal)).toThrow("total byte");

    const tooMany = Array.from(
      { length: EVIDENCE_ARTIFACT_LIMITS.maxArtifacts + 1 },
      (_, index) => artifact({
        artifactId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        localFilename: `viewport-${index}.png`,
      }),
    );
    expect(() => parseEvidenceArtifacts(tooMany)).toThrow();
  });

  it("accepts exactly nine route/viewport artifacts and rejects a tenth", () => {
    const routeViewportArtifacts = Array.from({ length: 9 }, (_, index) => artifact({
      artifactId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      localFilename: `route-viewport-${index}.png`,
    }));

    expect(parseEvidenceArtifacts(routeViewportArtifacts)).toHaveLength(9);
    expect(() => parseEvidenceArtifacts([
      ...routeViewportArtifacts,
      artifact({
        artifactId: "00000000-0000-4000-8000-000000000010",
        localFilename: "route-viewport-9.png",
      }),
    ])).toThrow();
  });

  it("requires the filename extension to match the declared raster MIME", () => {
    expect(() => parseEvidenceArtifacts([
      artifact({ contentType: "image/jpeg", localFilename: "desktop.png" }),
    ])).toThrow("extension");
  });
});
