import { Elysia, t } from "elysia";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "@almirant/config";
import { getS3Client, isS3Configured } from "../../../shared/services/s3-service";
import { env } from "@almirant/config";
import { errorResponse } from "../../../shared/services/response";

/** Map file extension to MIME type */
const MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const getMimeType = (path: string): string => {
  const ext = path.lastIndexOf(".") !== -1 ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
  return MIME_TYPES[ext] || "application/octet-stream";
};

const normalizeWildcardPath = (path: string): string => path.replace(/^\/+/, "");

const buildCandidateS3Keys = (projectId: string, wildcardPath: string): string[] => {
  const normalized = normalizeWildcardPath(wildcardPath);
  const base = `doc-assets/${projectId}/`;

  // Primary key (preferred convention)
  const keys = [base + normalized];

  // Backwards/alternate conventions:
  // - Some doc sources include "docs/" in stored paths, while assets are stored without it (or vice versa).
  if (normalized.startsWith("docs/")) {
    keys.push(base + normalized.slice("docs/".length));
  } else {
    keys.push(base + `docs/${normalized}`);
  }

  // De-duplicate while keeping order.
  return Array.from(new Set(keys));
};

export const documentAssetsRoutes = new Elysia({ prefix: "/api/document-assets" })
  .get(
    "/:projectId/*",
    async ({ params, set }) => {
      if (!isS3Configured()) {
        set.status = 503;
        return errorResponse("S3 storage is not configured");
      }

      const projectId = params.projectId;
      const wildcardPath = params["*"];

      if (!wildcardPath) {
        set.status = 400;
        return errorResponse("Asset path is required");
      }

      const candidateKeys = buildCandidateS3Keys(projectId, wildcardPath);
      const contentType = getMimeType(wildcardPath);

      const client = getS3Client();

      for (const s3Key of candidateKeys) {
        try {
          const command = new GetObjectCommand({
            Bucket: env.S3_BUCKET!,
            Key: s3Key,
          });

          const response = await client.send(command);

          if (!response.Body) {
            // Treat as not found and try the next key.
            continue;
          }

          const bodyBytes = await response.Body.transformToByteArray();

          set.headers["content-type"] = contentType;
          set.headers["cache-control"] = "public, max-age=86400";

          return new Response(bodyBytes, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
            },
          });
        } catch (err: unknown) {
          const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };

          // Not found -> try next candidate key.
          if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
            continue;
          }

          logger.error({ err, s3Key }, "Failed to fetch document asset from S3");
          set.status = 500;
          return errorResponse("Failed to fetch asset");
        }
      }

      logger.warn(
        {
          bucket: env.S3_BUCKET,
          projectId,
          wildcardPath,
          candidateKeys,
        },
        "Document asset not found in S3"
      );
      set.status = 404;
      return errorResponse("Asset not found");
    },
    {
      params: t.Object({
        projectId: t.String(),
        "*": t.String(),
      }),
    }
  );
