import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, logger } from "@almirant/config";

let s3Client: S3Client | null = null;

export const getS3Client = (): S3Client => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY!,
        secretAccessKey: env.S3_SECRET_KEY!,
      },
      forcePathStyle: !!env.S3_ENDPOINT,
    });
  }
  return s3Client;
};

export const isS3Configured = (bucketOverride?: string | null): boolean => {
  return !!(
    env.S3_ACCESS_KEY &&
    env.S3_SECRET_KEY &&
    (bucketOverride ?? env.S3_BUCKET)
  );
};

export const getEditorUploadsBucket = (): string | null => {
  return env.S3_PRIVATE_BUCKET ?? env.S3_BUCKET ?? null;
};

export const uploadBufferToS3 = async (
  buffer: Uint8Array,
  key: string,
  contentType: string,
  bucketOverride?: string
): Promise<string> => {
  const client = getS3Client();
  const bucket = bucketOverride ?? env.S3_BUCKET!;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=86400",
    })
  );

  let url: string;
  if (env.S3_ENDPOINT) {
    url = `${env.S3_ENDPOINT}/${bucket}/${key}`;
  } else {
    url = `https://${bucket}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
  }

  logger.info({ key, bucket }, "Uploaded file to S3");
  return url;
};

export const downloadBufferFromS3 = async (
  key: string,
  bucketOverride?: string,
): Promise<Uint8Array> => {
  const client = getS3Client();
  const bucket = bucketOverride ?? env.S3_BUCKET!;

  let response;
  try {
    response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download file from S3 (${key}): ${message}`);
  }

  if (!response.Body) {
    throw new Error(`Empty response body for S3 key: ${key}`);
  }

  const bodyBytes = await response.Body.transformToByteArray();
  logger.info({ key, bucket }, "Downloaded file from S3");
  return bodyBytes;
};

export const deleteFromS3 = async (key: string): Promise<void> => {
  const client = getS3Client();
  const bucket = env.S3_BUCKET!;

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  logger.info({ key, bucket }, "Deleted file from S3");
};

export const generateAttachmentKey = (
  workItemId: string,
  fileName: string
): string => {
  const uuid = crypto.randomUUID();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `work-items/${workItemId}/${uuid}-${sanitizedName}`;
};

export const generateEditorImageKey = (
  organizationId: string,
  fileName: string
): string => {
  const uuid = crypto.randomUUID();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `editor-images/${organizationId}/${uuid}-${sanitizedName}`;
};

export const generateEditorFileKey = (
  organizationId: string,
  fileName: string
): string => {
  const uuid = crypto.randomUUID();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `editor-files/${organizationId}/${uuid}-${sanitizedName}`;
};

/**
 * Generate an S3 key for feedback screenshots. Uses a flat prefix with no
 * organization scoping — access control is enforced at the API layer based
 * on feedback-item ownership (author OR platform admin), not the uploader's
 * active organization. See task A-1906.
 */
export const generateFeedbackScreenshotKey = (fileName: string): string => {
  const uuid = crypto.randomUUID();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `feedback-screenshots/${uuid}-${sanitizedName}`;
};

export const generateInvoiceKey = (organizationId: string, fileName: string): string => {
  const uuid = crypto.randomUUID();
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `invoices/${organizationId}/${uuid}-${sanitizedName}`;
};

export const extractKeyFromUrl = (url: string): string | null => {
  try {
    const urlObj = url.startsWith("/")
      ? new URL(url, "http://localhost")
      : new URL(url);
    const path = urlObj.pathname;

    if (path.startsWith("/api/uploads/images/")) {
      return decodeURIComponent(path.slice("/api/uploads/images/".length));
    }

    if (path.startsWith("/api/uploads/files/")) {
      return decodeURIComponent(path.slice("/api/uploads/files/".length));
    }

    // For path-style URLs: /bucket/key or just /key
    const parts = path.split("/").filter(Boolean);
    const configuredEndpointHost = env.S3_ENDPOINT
      ? new URL(env.S3_ENDPOINT).host
      : null;
    const configuredBuckets = [env.S3_BUCKET, env.S3_PRIVATE_BUCKET].filter(
      (bucket): bucket is string => Boolean(bucket)
    );

    // Skip bucket name for path-style URLs from the configured object-storage endpoint.
    // This keeps legacy URLs working even if the bucket name changed during migration.
    if (configuredEndpointHost && urlObj.host === configuredEndpointHost && parts.length >= 2) {
      return parts.slice(1).join("/");
    }

    // Skip bucket name if present in path
    const bucketFromPath = parts[0];
    if (parts.length >= 2 && bucketFromPath && configuredBuckets.includes(bucketFromPath)) {
      return parts.slice(1).join("/");
    }
    return parts.join("/");
  } catch {
    return null;
  }
};
