import { createHash } from "node:crypto";
import { describe, expect, it, mock } from "bun:test";
import {
  EVIDENCE_ARTIFACT_LIMITS,
  type EvidenceArtifactDescriptor,
} from "@almirant/shared";
import type { EvidenceArtifactDownloadResponse } from "@almirant/remote-agent";
import {
  EVIDENCE_DIRECTORY_PATH,
  EVIDENCE_MANIFEST_PATH,
  provisionEvidenceArtifacts,
} from "./evidence-artifact-provisioner";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]);
const WEBP = Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBPVP8 ", "binary");

const digest = (value: Buffer): string => createHash("sha256").update(value).digest("hex");

const descriptor = (
  id: number,
  content: Buffer,
  contentType: EvidenceArtifactDescriptor["contentType"],
  localFilename: string,
): EvidenceArtifactDescriptor => ({
  artifactId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  sha256: digest(content),
  byteSize: content.length,
  contentType,
  localFilename,
});

const stream = (chunks: Buffer[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

const download = (
  artifact: EvidenceArtifactDescriptor,
  content: Buffer,
  overrides: Partial<Omit<EvidenceArtifactDownloadResponse, "body">> = {},
): EvidenceArtifactDownloadResponse => ({
  body: stream([content.subarray(0, 3), content.subarray(3)]),
  contentType: artifact.contentType,
  byteSize: artifact.byteSize,
  sha256: artifact.sha256,
  ...overrides,
});

const driver = (options: { failWriteAt?: number; failExecAt?: number } = {}) => {
  const execCalls: string[][] = [];
  const writes: Array<{ path: string; content: Buffer; mode: string | undefined }> = [];
  let writeCount = 0;
  let execCount = 0;

  return {
    execCalls,
    writes,
    containerManager: {
      execInContainer: mock(async (_containerId: string, command: string[]) => {
        execCount += 1;
        execCalls.push(command);
        if (options.failExecAt === execCount) {
          return { exitCode: 41, stdout: "", stderr: "unsafe symlink" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
      writeFileBufferViaExec: mock(async (
        _containerId: string,
        filePath: string,
        content: Buffer,
        mode?: string,
      ) => {
        writeCount += 1;
        writes.push({ path: filePath, content, mode });
        if (options.failWriteAt === writeCount) throw new Error("simulated partial write");
      }),
    },
  };
};

describe("provisionEvidenceArtifacts", () => {
  it("streams PNG/JPEG/WebP beside the cloned repo and writes a stable manifest", async () => {
    const artifacts = [
      descriptor(1, PNG, "image/png", "desktop.png"),
      descriptor(2, JPEG, "image/jpeg", "mobile.jpg"),
      descriptor(3, WEBP, "image/webp", "tablet.webp"),
    ];
    const payloads = new Map([
      [artifacts[0]!.artifactId, PNG],
      [artifacts[1]!.artifactId, JPEG],
      [artifacts[2]!.artifactId, WEBP],
    ]);
    const testDriver = driver();

    const result = await provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts,
      containerManager: testDriver.containerManager,
      downloadArtifact: async (artifactId) => {
        const artifact = artifacts.find((candidate) => candidate.artifactId === artifactId)!;
        return download(artifact, payloads.get(artifactId)!);
      },
    });

    expect(result).toEqual({
      filesWritten: 3,
      totalBytes: PNG.length + JPEG.length + WEBP.length,
      manifestPath: EVIDENCE_MANIFEST_PATH,
    });
    expect(testDriver.writes.map((write) => write.path)).toEqual([
      `${EVIDENCE_DIRECTORY_PATH}/.artifact-1.partial`,
      `${EVIDENCE_DIRECTORY_PATH}/.artifact-2.partial`,
      `${EVIDENCE_DIRECTORY_PATH}/.artifact-3.partial`,
      `${EVIDENCE_DIRECTORY_PATH}/.manifest.partial`,
    ]);
    expect(testDriver.writes.every((write) => write.mode === "0600")).toBe(true);

    const manifest = JSON.parse(testDriver.writes.at(-1)!.content.toString("utf8")) as {
      schemaVersion: string;
      artifacts: Array<{ absolutePath: string; artifactId: string }>;
    };
    expect(manifest.schemaVersion).toBe("almirant.evidence-manifest.v1");
    expect(manifest.artifacts.map((item) => item.absolutePath)).toEqual([
      `${EVIDENCE_DIRECTORY_PATH}/desktop.png`,
      `${EVIDENCE_DIRECTORY_PATH}/mobile.jpg`,
      `${EVIDENCE_DIRECTORY_PATH}/tablet.webp`,
    ]);
    expect(JSON.stringify(manifest)).not.toContain("http");
    expect(testDriver.execCalls.some((call) =>
      call.join(" ") === `chmod 0555 ${EVIDENCE_DIRECTORY_PATH}`
    )).toBe(true);
  });

  it.each([
    ["MIME", { contentType: "image/jpeg" }],
    ["size header", { byteSize: PNG.length + 1 }],
    ["digest header", { sha256: "b".repeat(64) }],
  ])("rejects a %s mismatch and cleans the sidecar", async (_label, override) => {
    const artifact = descriptor(1, PNG, "image/png", "desktop.png");
    const testDriver = driver();

    await expect(provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts: [artifact],
      containerManager: testDriver.containerManager,
      downloadArtifact: async () => download(artifact, PNG, override),
    })).rejects.toThrow("mismatch");

    expect(testDriver.execCalls.some((call) => call.join(" ").includes("rm -rf"))).toBe(true);
  });

  it("cancels an unconsumed response body before rejecting header metadata", async () => {
    const artifact = descriptor(1, PNG, "image/png", "desktop.png");
    const testDriver = driver();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    await expect(provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts: [artifact],
      containerManager: testDriver.containerManager,
      downloadArtifact: async () => ({
        body,
        contentType: "image/jpeg",
        byteSize: artifact.byteSize,
        sha256: artifact.sha256,
      }),
    })).rejects.toThrow("content-type mismatch");

    expect(cancelled).toBe(true);
  });

  it("rejects magic-byte and streamed-size mismatches", async () => {
    const artifact = descriptor(1, PNG, "image/png", "desktop.png");
    const testDriver = driver();
    const wrongMagic = Buffer.alloc(PNG.length, 0x41);

    await expect(provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts: [artifact],
      containerManager: testDriver.containerManager,
      downloadArtifact: async () => download(artifact, wrongMagic),
    })).rejects.toThrow("magic bytes");

    const extraByteDriver = driver();
    await expect(provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts: [artifact],
      containerManager: extraByteDriver.containerManager,
      downloadArtifact: async () => ({
        ...download(artifact, PNG),
        body: stream([PNG, Buffer.from([0])]),
      }),
    })).rejects.toThrow("streamed byte size");
  });

  it("rejects bytes whose actual digest differs after header verification", async () => {
    const artifact = descriptor(1, PNG, "image/png", "desktop.png");
    const tamperedPng = Buffer.from(PNG);
    tamperedPng[tamperedPng.length - 1] = 0x01;
    const testDriver = driver();

    await expect(provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts: [artifact],
      containerManager: testDriver.containerManager,
      downloadArtifact: async () => download(artifact, tamperedPng),
    })).rejects.toThrow("digest mismatch");
  });

  it("rejects traversal, duplicate IDs/names and count/size caps before downloading", async () => {
    const artifact = descriptor(1, PNG, "image/png", "desktop.png");
    const downloadArtifact = mock(async () => download(artifact, PNG));

    for (const artifacts of [
      [{ ...artifact, localFilename: "../desktop.png" }],
      [artifact, { ...artifact, localFilename: "other.png" }],
      [artifact, { ...artifact, artifactId: "00000000-0000-4000-8000-000000000002" }],
      [{ ...artifact, byteSize: EVIDENCE_ARTIFACT_LIMITS.maxArtifactBytes + 1 }],
      Array.from(
        { length: EVIDENCE_ARTIFACT_LIMITS.maxArtifacts + 1 },
        (_, index) => ({
          ...artifact,
          artifactId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          localFilename: `viewport-${index}.png`,
        }),
      ),
    ]) {
      await expect(provisionEvidenceArtifacts({
        containerId: "container-1",
        artifacts,
        containerManager: driver().containerManager,
        downloadArtifact,
      })).rejects.toThrow();
    }

    expect(downloadArtifact).not.toHaveBeenCalled();
  });

  it("removes partial files when an atomic container write fails", async () => {
    const artifact = descriptor(1, PNG, "image/png", "desktop.png");
    const testDriver = driver({ failWriteAt: 1 });

    await expect(provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts: [artifact],
      containerManager: testDriver.containerManager,
      downloadArtifact: async () => download(artifact, PNG),
    })).rejects.toThrow("simulated partial write");

    expect(testDriver.execCalls.some((call) => call.join(" ").includes("rm -rf"))).toBe(true);
  });

  it("fails before download when the fixed evidence directory is a symlink", async () => {
    const artifact = descriptor(1, PNG, "image/png", "desktop.png");
    const testDriver = driver({ failExecAt: 1 });
    const downloadArtifact = mock(async () => download(artifact, PNG));

    await expect(provisionEvidenceArtifacts({
      containerId: "container-1",
      artifacts: [artifact],
      containerManager: testDriver.containerManager,
      downloadArtifact,
    })).rejects.toThrow("Preparing evidence directory failed");

    expect(testDriver.execCalls[0]!.join(" ")).toContain('[ -L "$parent" ]');
    expect(testDriver.execCalls[0]!.join(" ")).toContain('[ -L "$evidence" ]');
    expect(downloadArtifact).not.toHaveBeenCalled();
    expect(testDriver.writes).toEqual([]);
  });
});
