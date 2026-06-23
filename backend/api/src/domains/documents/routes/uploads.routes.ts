import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import { env, logger } from "@almirant/config";
import {
  getEditorUploadsBucket,
  getS3Client,
  isS3Configured,
  uploadBufferToS3,
  generateEditorImageKey,
  generateEditorFileKey,
} from "../../../shared/services/s3-service";
import { successResponse, errorResponse } from "../../../shared/services/response";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "text/",
];

const isAllowedMimeType = (mimeType: string): boolean =>
  ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));

const buildEditorAssetUrl = (kind: "images" | "files", key: string): string =>
  `/api/uploads/${kind}/${key}`;

const getEditorAssetPrefix = (kind: "images" | "files", organizationId: string): string =>
  `${kind === "images" ? "editor-images" : "editor-files"}/${organizationId}/`;

const fetchEditorAsset = async ({
  key,
  kind,
  organizationId,
  set,
}: {
  key: string;
  kind: "images" | "files";
  organizationId: string;
  set: { status?: unknown; headers: Record<string, unknown> };
}) => {
  const bucket = getEditorUploadsBucket();
  if (!bucket || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
    set.status = 503;
    return errorResponse("S3 storage is not configured");
  }

  const expectedPrefix = getEditorAssetPrefix(kind, organizationId);
  if (!key.startsWith(expectedPrefix)) {
    set.status = 403;
    return errorResponse("Forbidden");
  }

  try {
    const client = getS3Client();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      set.status = 404;
      return errorResponse("Asset not found");
    }

    const bodyBytes = await response.Body.transformToByteArray();
    const contentType =
      response.ContentType ||
      (kind === "images" ? "image/png" : "application/octet-stream");
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
    const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };

    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      set.status = 404;
      return errorResponse("Asset not found");
    }

    logger.error({ err, key, kind, organizationId }, "Failed to fetch private editor asset from S3");
    set.status = 500;
    return errorResponse("Failed to fetch asset");
  }
};

export const uploadsRoutes = new Elysia({ prefix: "/uploads" })
  .use(sessionContextTypes)

  // POST /uploads/images - Upload an image to S3 (generic, for editor usage)
  .post(
    "/images",
    async ({ body, set, activeOrganization }) => {
      try {
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

        const orgId = activeOrganization!.id;
        let buffer: Uint8Array = new Uint8Array(await file.arrayBuffer());
        let fileName = file.name;
        let contentType = mimeType;

        // Best-effort compression for large images (>2MB)
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

        const key = generateEditorImageKey(orgId, fileName);
        await uploadBufferToS3(buffer, key, contentType, bucket);

        logger.info({ key, orgId, originalSize: file.size, finalSize: buffer.length }, "Editor image uploaded");

        set.status = 201;
        return successResponse({ url: buildEditorAssetUrl("images", key) });
      } catch (error) {
        logger.error({ error }, "Failed to upload editor image");
        set.status = 500;
        return errorResponse("Failed to upload image");
      }
    },
    {
      body: t.Object({
        file: t.File(),
      }),
    }
  )

  // POST /uploads/files - Upload any supported file to S3 (images, PDFs, docs, etc.)
  .post(
    "/files",
    async ({ body, set, activeOrganization }) => {
      try {
        const file = body.file;
        if (!file) {
          set.status = 400;
          return errorResponse("File is required");
        }

        const mimeType = file.type;
        if (!mimeType || !isAllowedMimeType(mimeType)) {
          set.status = 400;
          return errorResponse("File type is not supported");
        }

        const isImage = mimeType.startsWith("image/");
        const sizeLimit = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;

        if (file.size > sizeLimit) {
          set.status = 400;
          return errorResponse(
            `File size exceeds ${isImage ? "5MB" : "10MB"} limit`
          );
        }

        const bucket = getEditorUploadsBucket();
        if (!bucket || !isS3Configured(bucket)) {
          set.status = 503;
          return errorResponse("S3 storage is not configured");
        }

        const orgId = activeOrganization!.id;
        let buffer: Uint8Array = new Uint8Array(await file.arrayBuffer());
        let fileName = file.name;
        let contentType = mimeType;

        // Best-effort compression for large images (>2MB)
        if (isImage && buffer.length > 2_000_000) {
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

        const key = isImage
          ? generateEditorImageKey(orgId, fileName)
          : generateEditorFileKey(orgId, fileName);
        await uploadBufferToS3(buffer, key, contentType, bucket);

        logger.info(
          { key, orgId, originalSize: file.size, finalSize: buffer.length, mimeType: contentType },
          "Editor file uploaded"
        );

        set.status = 201;
        return successResponse({
          url: buildEditorAssetUrl(isImage ? "images" : "files", key),
          fileName: file.name,
          mimeType: contentType,
        });
      } catch (error) {
        logger.error({ error }, "Failed to upload editor file");
        set.status = 500;
        return errorResponse("Failed to upload file");
      }
    },
    {
      body: t.Object({
        file: t.File(),
      }),
    }
  )
  .get(
    "/images/*",
    async ({ params, set, activeOrganization }) =>
      fetchEditorAsset({
        key: params["*"],
        kind: "images",
        organizationId: activeOrganization!.id,
        set,
      }),
    {
      params: t.Object({
        "*": t.String(),
      }),
    }
  )
  .get(
    "/files/*",
    async ({ params, set, activeOrganization }) =>
      fetchEditorAsset({
        key: params["*"],
        kind: "files",
        organizationId: activeOrganization!.id,
        set,
      }),
    {
      params: t.Object({
        "*": t.String(),
      }),
    }
  );
