import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { env, logger } from "@almirant/config";
import { getS3Client, isS3Configured } from "../../../shared/services/s3-service";

/**
 * Generate S3 key for a document.
 * Pattern: docs/{projectId}/{filePath}/{hash}.md
 */
export const generateDocumentKey = (
  projectId: string,
  filePath: string,
  contentHash: string
): string => {
  const normalizedPath = filePath.replace(/^\/+/, "");
  return `docs/${projectId}/${normalizedPath}/${contentHash}.md`;
};

/**
 * Upload document content to S3.
 * Returns the S3 key used for storage.
 */
export const uploadDocument = async (
  projectId: string,
  filePath: string,
  content: string,
  contentHash: string
): Promise<string> => {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const key = generateDocumentKey(projectId, filePath, contentHash);
  const client = getS3Client();
  const bucket = env.S3_BUCKET!;

  const encoder = new TextEncoder();
  const body = encoder.encode(content);

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "text/markdown; charset=utf-8",
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to upload document to S3 (${key}): ${message}`);
  }

  logger.info({ key, bucket, projectId, filePath }, "Uploaded document to S3");
  return key;
};

/**
 * Download document content from S3 by key.
 * Returns the content as a string.
 */
export const downloadDocument = async (s3Key: string): Promise<string> => {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const client = getS3Client();
  const bucket = env.S3_BUCKET!;

  let response;
  try {
    response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to download document from S3 (${s3Key}): ${message}`);
  }

  if (!response.Body) {
    throw new Error(`Empty response body for S3 key: ${s3Key}`);
  }

  const bodyString = await response.Body.transformToString("utf-8");
  logger.info({ s3Key, bucket }, "Downloaded document from S3");
  return bodyString;
};

/**
 * Delete a document from S3 by key.
 */
export const deleteDocument = async (s3Key: string): Promise<void> => {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const client = getS3Client();
  const bucket = env.S3_BUCKET!;

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: s3Key,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete document from S3 (${s3Key}): ${message}`);
  }

  logger.info({ s3Key, bucket }, "Deleted document from S3");
};
