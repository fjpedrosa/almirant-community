import { createHash } from "node:crypto";
import {
  EVIDENCE_ARTIFACT_LIMITS,
  parseEvidenceArtifacts,
  type EvidenceArtifactContentType,
  type EvidenceArtifactDescriptor,
} from "@almirant/shared";
import type { EvidenceArtifactDownloadResponse } from "@almirant/remote-agent";
import type { ContainerDriver } from "./container-driver";

export const EVIDENCE_DIRECTORY_PATH = "/workspace/repo/.almirant/evidence";
export const EVIDENCE_MANIFEST_PATH = `${EVIDENCE_DIRECTORY_PATH}/manifest.json`;

type EvidenceContainerDriver = Pick<
  ContainerDriver,
  "execInContainer" | "writeFileBufferViaExec"
>;

export type EvidenceArtifactProvisionerInput = {
  containerId: string;
  artifacts: readonly EvidenceArtifactDescriptor[];
  downloadArtifact: (artifactId: string) => Promise<EvidenceArtifactDownloadResponse>;
  containerManager: EvidenceContainerDriver;
};

type EvidenceManifest = {
  schemaVersion: "almirant.evidence-manifest.v1";
  artifacts: Array<{
    artifactId: string;
    sha256: string;
    byteSize: number;
    contentType: EvidenceArtifactContentType;
    localFilename: string;
    absolutePath: string;
  }>;
};

const execOrThrow = async (
  containerManager: EvidenceContainerDriver,
  containerId: string,
  command: string[],
  operation: string,
): Promise<void> => {
  const result = await containerManager.execInContainer(containerId, command, "/");
  if (result.exitCode !== 0) {
    throw new Error(`${operation} failed (exit ${result.exitCode}): ${result.stderr}`);
  }
};

const prepareEvidenceDirectory = async (
  containerManager: EvidenceContainerDriver,
  containerId: string,
): Promise<void> => {
  await execOrThrow(
    containerManager,
    containerId,
    [
      "sh",
      "-ceu",
      [
        'parent="/workspace/repo/.almirant"',
        `evidence="${EVIDENCE_DIRECTORY_PATH}"`,
        'if [ -L "$parent" ] || { [ -e "$parent" ] && [ ! -d "$parent" ]; }; then exit 40; fi',
        'mkdir -p "$parent"',
        'if [ -L "$evidence" ] || [ -e "$evidence" ]; then exit 41; fi',
        'created=0',
        'cleanup_partial_directory() { if [ "$created" = "1" ]; then rm -rf "$evidence"; fi; }',
        'trap cleanup_partial_directory EXIT',
        'mkdir "$evidence"',
        'created=1',
        'chmod 0700 "$evidence"',
        'trap - EXIT',
      ].join("\n"),
    ],
    "Preparing evidence directory",
  );
};

const cleanupEvidenceDirectory = async (
  containerManager: EvidenceContainerDriver,
  containerId: string,
): Promise<void> => {
  await execOrThrow(
    containerManager,
    containerId,
    ["sh", "-ceu", `rm -rf "${EVIDENCE_DIRECTORY_PATH}"`],
    "Cleaning evidence directory",
  );
};

const commitAtomicFile = async ({
  containerManager,
  containerId,
  temporaryPath,
  targetPath,
}: {
  containerManager: EvidenceContainerDriver;
  containerId: string;
  temporaryPath: string;
  targetPath: string;
}): Promise<void> => {
  await execOrThrow(
    containerManager,
    containerId,
    [
      "sh",
      "-ceu",
      '[ ! -L "$2" ] && [ ! -e "$2" ] && mv "$1" "$2" && chmod 0444 "$2"',
      "evidence-commit",
      temporaryPath,
      targetPath,
    ],
    "Committing evidence file",
  );
};

const readCappedBody = async (
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
): Promise<Buffer> => {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;

      const chunk = Buffer.from(next.value);
      totalBytes += chunk.length;
      if (
        totalBytes > expectedBytes ||
        totalBytes > EVIDENCE_ARTIFACT_LIMITS.maxArtifactBytes
      ) {
        await reader.cancel("Evidence artifact exceeded declared byte size");
        throw new Error("Evidence artifact streamed byte size mismatch");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes !== expectedBytes) {
    throw new Error("Evidence artifact streamed byte size mismatch");
  }

  return Buffer.concat(chunks, totalBytes);
};

const hasExpectedMagicBytes = (
  contentType: EvidenceArtifactContentType,
  content: Buffer,
): boolean => {
  if (contentType === "image/png") {
    return content.length >= 8 && content.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (contentType === "image/jpeg") {
    return content.length >= 5 &&
      content[0] === 0xff &&
      content[1] === 0xd8 &&
      content[2] === 0xff &&
      content.at(-2) === 0xff &&
      content.at(-1) === 0xd9;
  }

  return content.length >= 12 &&
    content.subarray(0, 4).toString("ascii") === "RIFF" &&
    content.subarray(8, 12).toString("ascii") === "WEBP";
};

const verifyAndReadArtifact = async (
  artifact: EvidenceArtifactDescriptor,
  download: EvidenceArtifactDownloadResponse,
): Promise<Buffer> => {
  if (download.contentType !== artifact.contentType) {
    await download.body.cancel("Evidence artifact content-type mismatch").catch(() => undefined);
    throw new Error(`Evidence artifact ${artifact.artifactId} content-type mismatch`);
  }
  if (download.byteSize !== artifact.byteSize) {
    await download.body.cancel("Evidence artifact size header mismatch").catch(() => undefined);
    throw new Error(`Evidence artifact ${artifact.artifactId} size header mismatch`);
  }
  if (download.sha256 !== artifact.sha256) {
    await download.body.cancel("Evidence artifact digest header mismatch").catch(() => undefined);
    throw new Error(`Evidence artifact ${artifact.artifactId} digest header mismatch`);
  }

  const content = await readCappedBody(download.body, artifact.byteSize);
  if (!hasExpectedMagicBytes(artifact.contentType, content)) {
    throw new Error(`Evidence artifact ${artifact.artifactId} has invalid magic bytes`);
  }

  const actualDigest = createHash("sha256").update(content).digest("hex");
  if (actualDigest !== artifact.sha256) {
    throw new Error(`Evidence artifact ${artifact.artifactId} digest mismatch`);
  }

  return content;
};

export const provisionEvidenceArtifacts = async ({
  containerId,
  artifacts: rawArtifacts,
  downloadArtifact,
  containerManager,
}: EvidenceArtifactProvisionerInput): Promise<{
  filesWritten: number;
  totalBytes: number;
  manifestPath: typeof EVIDENCE_MANIFEST_PATH;
}> => {
  const artifacts = parseEvidenceArtifacts(rawArtifacts);
  let directoryPrepared = false;
  let filesWritten = 0;
  let totalBytes = 0;

  try {
    await prepareEvidenceDirectory(containerManager, containerId);
    directoryPrepared = true;

    for (const [index, artifact] of artifacts.entries()) {
      const download = await downloadArtifact(artifact.artifactId);
      const content = await verifyAndReadArtifact(artifact, download);
      const temporaryPath = `${EVIDENCE_DIRECTORY_PATH}/.artifact-${index + 1}.partial`;
      const targetPath = `${EVIDENCE_DIRECTORY_PATH}/${artifact.localFilename}`;

      await containerManager.writeFileBufferViaExec(
        containerId,
        temporaryPath,
        content,
        "0600",
      );
      await commitAtomicFile({
        containerManager,
        containerId,
        temporaryPath,
        targetPath,
      });

      filesWritten += 1;
      totalBytes += content.length;
    }

    const manifest: EvidenceManifest = {
      schemaVersion: "almirant.evidence-manifest.v1",
      artifacts: artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
        contentType: artifact.contentType,
        localFilename: artifact.localFilename,
        absolutePath: `${EVIDENCE_DIRECTORY_PATH}/${artifact.localFilename}`,
      })),
    };
    const temporaryManifestPath = `${EVIDENCE_DIRECTORY_PATH}/.manifest.partial`;
    await containerManager.writeFileBufferViaExec(
      containerId,
      temporaryManifestPath,
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      "0600",
    );
    await commitAtomicFile({
      containerManager,
      containerId,
      temporaryPath: temporaryManifestPath,
      targetPath: EVIDENCE_MANIFEST_PATH,
    });
    await execOrThrow(
      containerManager,
      containerId,
      ["chmod", "0555", EVIDENCE_DIRECTORY_PATH],
      "Marking evidence directory read-only",
    );

    return { filesWritten, totalBytes, manifestPath: EVIDENCE_MANIFEST_PATH };
  } catch (error) {
    if (directoryPrepared) {
      try {
        await cleanupEvidenceDirectory(containerManager, containerId);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Evidence provisioning failed and partial-file cleanup also failed",
        );
      }
    }
    throw error;
  }
};
