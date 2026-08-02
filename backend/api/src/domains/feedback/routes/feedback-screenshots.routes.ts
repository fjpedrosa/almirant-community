import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Elysia, t } from "elysia";
import { logger } from "@almirant/config";
import { getFeedbackItemById } from "@almirant/database";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  getEditorUploadsBucket,
  getS3Client,
  isS3Configured,
  uploadBufferToS3,
  generateFeedbackScreenshotKey,
} from "../../../shared/services/s3-service";
import { successResponse, errorResponse } from "../../../shared/services/response";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const FEEDBACK_SCREENSHOT_PREFIX = "feedback-screenshots/";
const LEGACY_PATH_PREFIX = "/api/uploads/images/";

interface FeedbackItemMetadataWithScreenshot {
  screenshotKey?: string | null;
  screenshotUrl?: string | null;
  [key: string]: unknown;
}

interface FeedbackAuthorMeta {
  userId?: string | null;
  [key: string]: unknown;
}

/**
 * Resolve the S3 key that stores the screenshot for a given feedback item.
 * Preference order:
 *   1. `metadata.screenshotKey` (new feedback items — stored as `feedback-screenshots/<uuid>-<name>`)
 *   2. Legacy `metadata.screenshotUrl` pointing to `/api/uploads/images/<key>` — extract the suffix.
 * Returns `null` when no screenshot reference exists.
 */
const resolveScreenshotKey = (
  metadata: FeedbackItemMetadataWithScreenshot | null | undefined
): { key: string; legacy: boolean } | null => {
  if (!metadata) return null;

  if (
    typeof metadata.screenshotKey === "string" &&
    metadata.screenshotKey.startsWith(FEEDBACK_SCREENSHOT_PREFIX)
  ) {
    return { key: metadata.screenshotKey, legacy: false };
  }

  if (
    typeof metadata.screenshotUrl === "string" &&
    metadata.screenshotUrl.startsWith(LEGACY_PATH_PREFIX)
  ) {
    const suffix = metadata.screenshotUrl.slice(LEGACY_PATH_PREFIX.length);
    if (suffix.length > 0) {
      return { key: decodeURIComponent(suffix), legacy: true };
    }
  }

  return null;
};

export const feedbackScreenshotsRoutes = new Elysia()
  .use(sessionContextTypes)

  // POST /feedback-screenshots
  // Authenticated upload of a feedback screenshot. The object is stored in S3
  // under a FLAT `feedback-screenshots/<uuid>-<name>` key (no workspace prefix) so
  // viewers with a different activeWorkspace (e.g. platform admins) can
  // still resolve it via the feedback-item-scoped GET endpoint below.
  .post(
    "/feedback-screenshots",
    async ({ body, set, user }) => {
      try {
        if (!user) {
          set.status = 401;
          return errorResponse("Authentication required");
        }

        const file = body.file;
        if (!file) {
          set.status = 400;
          return errorResponse("File is required");
        }

        const mimeType = file.type;
        if (!mimeType || !mimeType.startsWith("image/")) {
          set.status = 400;
          return errorResponse("Only image files are allowed");
        }

        if (file.size > MAX_IMAGE_SIZE) {
          set.status = 400;
          return errorResponse("File size exceeds 5MB limit");
        }

        const bucket = getEditorUploadsBucket();
        if (!bucket || !isS3Configured(bucket)) {
          set.status = 503;
          return errorResponse("S3 storage is not configured");
        }

        let buffer: Uint8Array = new Uint8Array(await file.arrayBuffer());
        let fileName = file.name;
        let contentType = mimeType;

        // Best-effort compression for large images (>2MB) — mirrors uploads.routes.ts.
        if (buffer.length > 2_000_000) {
          try {
            const sharpMod = await import("sharp");
            const sharp = sharpMod.default;

            if (mimeType === "image/png") {
              const next = await sharp(buffer)
                .png({ compressionLevel: 9, palette: true, quality: 80 })
                .toBuffer();
              if (next.length < buffer.length) buffer = next;
            }

            if (buffer.length > 2_000_000) {
              const next = await sharp(buffer)
                .jpeg({ quality: 75, mozjpeg: true })
                .toBuffer();
              buffer = next;
              contentType = "image/jpeg";
              fileName = fileName.replace(/\.[^.]+$/, ".jpg");
            }
          } catch {
            // sharp not available, keep original buffer
          }
        }

        const key = generateFeedbackScreenshotKey(fileName);
        await uploadBufferToS3(buffer, key, contentType, bucket);

        logger.info(
          {
            key,
            userId: user.id,
            originalSize: file.size,
            finalSize: buffer.length,
          },
          "Feedback screenshot uploaded"
        );

        set.status = 201;
        return successResponse({ key });
      } catch (error) {
        logger.error({ error }, "Failed to upload feedback screenshot");
        set.status = 500;
        return errorResponse("Failed to upload screenshot");
      }
    },
    {
      body: t.Object({
        file: t.File(),
      }),
    }
  )

  // GET /feedback-items/:id/screenshot
  // Serves the screenshot bytes for a feedback item, subject to ownership checks:
  //   - Platform admins can read every screenshot.
  //   - The author of the feedback item (matched via `authorMeta.userId`) can read their own.
  //   - Everyone else gets 403.
  // Legacy items whose screenshot was uploaded via /api/uploads/images keep working
  // via `metadata.screenshotUrl` extraction.
  .get(
    "/feedback-items/:id/screenshot",
    async ({ params, set, user }) => {
      if (!user) {
        set.status = 401;
        return errorResponse("Authentication required");
      }

      const feedbackItem = await getFeedbackItemById(params.id);
      if (!feedbackItem) {
        set.status = 404;
        return errorResponse("Feedback item not found");
      }

      const authorMeta = (feedbackItem.authorMeta ?? null) as FeedbackAuthorMeta | null;
      const userRole = (user as { role?: string | null }).role ?? null;
      const isAdmin = userRole === "admin";
      const isAuthor =
        typeof authorMeta?.userId === "string" && authorMeta.userId === user.id;

      if (!isAdmin && !isAuthor) {
        set.status = 403;
        return errorResponse("Forbidden: not authorized to view this screenshot");
      }

      const metadata =
        (feedbackItem.metadata ?? null) as FeedbackItemMetadataWithScreenshot | null;
      const resolved = resolveScreenshotKey(metadata);
      if (!resolved) {
        set.status = 404;
        return errorResponse("Screenshot not available for this feedback item");
      }

      const bucket = getEditorUploadsBucket();
      if (!bucket || !isS3Configured(bucket)) {
        set.status = 503;
        return errorResponse("S3 storage is not configured");
      }

      if (resolved.legacy) {
        logger.info(
          { feedbackItemId: feedbackItem.id, legacy: true },
          "feedback-screenshot-legacy-served"
        );
      }

      try {
        const client = getS3Client();
        const response = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: resolved.key,
          })
        );

        if (!response.Body) {
          set.status = 404;
          return errorResponse("Screenshot not found");
        }

        const bodyBytes = await response.Body.transformToByteArray();
        const contentType = response.ContentType || "image/png";
        const cacheControl = "private, max-age=300";

        set.headers["content-type"] = contentType;
        set.headers["cache-control"] = cacheControl;

        return new Response(bodyBytes, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": cacheControl,
          },
        });
      } catch (err: unknown) {
        const error = err as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };

        if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
          set.status = 404;
          return errorResponse("Screenshot not found");
        }

        logger.error(
          { err, feedbackItemId: feedbackItem.id, key: resolved.key },
          "Failed to fetch feedback screenshot from S3"
        );
        set.status = 500;
        return errorResponse("Failed to fetch screenshot");
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
