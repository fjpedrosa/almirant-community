import { z } from "zod";

export const EVIDENCE_ARTIFACT_LIMITS = Object.freeze({
  maxArtifacts: 9,
  maxArtifactBytes: 8 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxLocalFilenameLength: 128,
});

export const evidenceArtifactContentTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type EvidenceArtifactContentType = z.infer<
  typeof evidenceArtifactContentTypeSchema
>;

const SAFE_LOCAL_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const expectedExtensions: Record<EvidenceArtifactContentType, ReadonlySet<string>> = {
  "image/png": new Set([".png"]),
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/webp": new Set([".webp"]),
};

const evidenceArtifactDescriptorBaseSchema = z.strictObject({
  artifactId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().positive().max(EVIDENCE_ARTIFACT_LIMITS.maxArtifactBytes),
  contentType: evidenceArtifactContentTypeSchema,
  localFilename: z
    .string()
    .min(1)
    .max(EVIDENCE_ARTIFACT_LIMITS.maxLocalFilenameLength)
    .regex(SAFE_LOCAL_FILENAME_PATTERN, "localFilename must be a safe basename"),
});

export const evidenceArtifactDescriptorSchema =
  evidenceArtifactDescriptorBaseSchema.superRefine((artifact, context) => {
    const lastDot = artifact.localFilename.lastIndexOf(".");
    const extension = lastDot >= 0
      ? artifact.localFilename.slice(lastDot).toLowerCase()
      : "";

    if (!expectedExtensions[artifact.contentType].has(extension)) {
      context.addIssue({
        code: "custom",
        path: ["localFilename"],
        message: `localFilename extension does not match ${artifact.contentType}`,
      });
    }
  });

export type EvidenceArtifactDescriptor = Readonly<
  z.infer<typeof evidenceArtifactDescriptorSchema>
>;

export const evidenceArtifactsSchema = z
  .array(evidenceArtifactDescriptorSchema)
  .min(1)
  .max(EVIDENCE_ARTIFACT_LIMITS.maxArtifacts)
  .superRefine((artifacts, context) => {
    const artifactIds = new Set<string>();
    const localFilenames = new Set<string>();
    let totalBytes = 0;

    artifacts.forEach((artifact, index) => {
      if (artifactIds.has(artifact.artifactId)) {
        context.addIssue({
          code: "custom",
          path: [index, "artifactId"],
          message: "artifactId must be unique",
        });
      }
      artifactIds.add(artifact.artifactId);

      const normalizedFilename = artifact.localFilename.toLowerCase();
      if (localFilenames.has(normalizedFilename)) {
        context.addIssue({
          code: "custom",
          path: [index, "localFilename"],
          message: "localFilename must be unique ignoring case",
        });
      }
      localFilenames.add(normalizedFilename);
      totalBytes += artifact.byteSize;
    });

    if (totalBytes > EVIDENCE_ARTIFACT_LIMITS.maxTotalBytes) {
      context.addIssue({
        code: "custom",
        message: `Evidence artifacts exceed total byte limit (${EVIDENCE_ARTIFACT_LIMITS.maxTotalBytes})`,
      });
    }
  });

export const parseEvidenceArtifacts = (
  value: unknown,
): EvidenceArtifactDescriptor[] => evidenceArtifactsSchema.parse(value);
