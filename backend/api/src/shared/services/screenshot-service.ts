import { env, logger } from "@almirant/config";
import { db, schema, eq } from "@almirant/database";
import { isS3Configured, uploadBufferToS3 } from "./s3-service";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const LOCAL_SCREENSHOT_URL_PREFIX = "/project-screenshots/";

const getLocalScreenshotRoot = (): string =>
  path.resolve(
    process.env.ALMIRANT_STORAGE_DIR ?? path.join(process.cwd(), ".almirant-storage"),
    "screenshots",
  );

const sanitizePathSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_");

const buildLocalScreenshotUrl = (key: string): string =>
  `${LOCAL_SCREENSHOT_URL_PREFIX}${key.split(path.sep).join("/")}`;

const writeProjectScreenshotToDisk = async (
  projectId: string,
  buffer: Buffer,
  timestamp: number,
): Promise<string> => {
  const safeProjectId = sanitizePathSegment(projectId);
  const key = path.join("projects", safeProjectId, `${timestamp}.png`);
  const root = getLocalScreenshotRoot();
  const targetPath = path.resolve(root, key);

  if (!targetPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid local screenshot path");
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);

  return buildLocalScreenshotUrl(key);
};

export const isLocalProjectScreenshotUrl = (url: string): boolean =>
  url.startsWith(LOCAL_SCREENSHOT_URL_PREFIX);

export const readLocalProjectScreenshot = async (
  url: string,
): Promise<Uint8Array | null> => {
  if (!isLocalProjectScreenshotUrl(url)) return null;

  const key = decodeURIComponent(url.slice(LOCAL_SCREENSHOT_URL_PREFIX.length));
  const root = getLocalScreenshotRoot();
  const targetPath = path.resolve(root, key);

  if (!targetPath.startsWith(`${root}${path.sep}`)) return null;

  try {
    return await readFile(targetPath);
  } catch {
    return null;
  }
};

const buildThumIoUrl = (targetUrl: string): string => {
  const apiKey = env.THUM_IO_API_KEY;
  const base = apiKey
    ? `https://image.thum.io/get/auth/${apiKey}`
    : "https://image.thum.io/get";
  return `${base}/width/1280/${targetUrl}`;
};

export const captureAndStoreScreenshot = async (
  projectId: string,
  productionUrl: string
): Promise<string | null> => {
  try {
    const thumUrl = buildThumIoUrl(productionUrl);
    logger.info({ projectId, thumUrl }, "Capturing screenshot via thum.io");

    const response = await fetch(thumUrl, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, projectId },
        "thum.io returned non-OK status"
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer() as ArrayBuffer);

    if (buffer.length < 1000) {
      logger.warn(
        { size: buffer.length, projectId },
        "Screenshot too small, likely invalid"
      );
      return null;
    }

    const timestamp = Date.now();
    const screenshotUrl = isS3Configured()
      ? await uploadBufferToS3(
          buffer,
          `screenshots/projects/${projectId}/${timestamp}.png`,
          "image/png",
        )
      : await writeProjectScreenshotToDisk(projectId, buffer, timestamp);

    await db
      .update(schema.projects)
      .set({ screenshotUrl, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));

    logger.info({ projectId, screenshotUrl }, "Screenshot captured and stored");
    return screenshotUrl;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), projectId },
      "Failed to capture screenshot"
    );
    return null;
  }
};
