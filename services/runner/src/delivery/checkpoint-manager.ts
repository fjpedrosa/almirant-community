import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { ContainerDriver } from "../workspace/container-driver";

type CheckpointS3Config = {
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  endpoint?: string;
};

type CheckpointManagerConfig = {
  s3: CheckpointS3Config;
  intervalMs: number;
};

export type CheckpointManager = {
  readonly active: boolean;
  createCheckpoint(containerId: string, orgId: string, jobId: string): Promise<void>;
  restoreCheckpoint(containerId: string, orgId: string, jobId: string, previousJobId?: string): Promise<void>;
  hasCheckpoint(orgId: string, jobId: string, previousJobId?: string): Promise<boolean>;
  deleteCheckpoint(orgId: string, jobId: string): Promise<void>;
};

const makeKey = (orgId: string, jobId: string): string =>
  `checkpoints/${orgId}/${jobId}/latest.tar.gz`;

const createS3Client = (config: CheckpointS3Config): S3Client =>
  new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: !!config.endpoint,
  });

const streamToBuffer = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBuffer));
  }
  return Buffer.concat(chunks);
};

const createActiveCheckpointManager = (
  config: CheckpointManagerConfig,
  containerManager: ContainerDriver
): CheckpointManager => {
  const s3 = createS3Client(config.s3);
  const bucket = config.s3.bucket;

  const createCheckpoint = async (containerId: string, orgId: string, jobId: string): Promise<void> => {
    try {
      // Find modified files relative to last commit
      const { exitCode, stdout } = await containerManager.execInContainer(
        containerId,
        ["git", "diff", "--name-only", "HEAD"],
        "/workspace/repo"
      );

      if (exitCode !== 0 || !stdout.trim()) {
        // No modified files — skip creating an empty checkpoint
        return;
      }

      const modifiedFiles = stdout.trim().split("\n").filter(Boolean);
      if (modifiedFiles.length === 0) {
        return;
      }

      // Get tar archive of the workspace repo
      const tarStream = await containerManager.getArchiveFromContainer(containerId, "/workspace/repo");
      const tarBuffer = await streamToBuffer(tarStream);

      const key = makeKey(orgId, jobId);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: tarBuffer,
          ContentType: "application/gzip",
        })
      );
    } catch (error) {
      // Log but do not crash — checkpoint is best-effort
      console.error(`[checkpoint] Failed to create checkpoint for job ${jobId}:`, error);
    }
  };

  const restoreCheckpoint = async (containerId: string, orgId: string, jobId: string, previousJobId?: string): Promise<void> => {
    // Try current jobId first, fall back to previousJobId (A-860)
    const keysToTry = [makeKey(orgId, jobId)];
    if (previousJobId) {
      keysToTry.push(makeKey(orgId, previousJobId));
    }

    for (const key of keysToTry) {
      try {
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

        if (!response.Body) {
          continue;
        }

        const tarBuffer = await streamToBuffer(response.Body as NodeJS.ReadableStream);
        await containerManager.restoreArchiveViaExec(containerId, tarBuffer, "/workspace/repo");
        return;
      } catch {
        // Try next key
      }
    }

    console.error(`[checkpoint] Failed to restore checkpoint for job ${jobId}: no checkpoint found`);
  };

  const hasCheckpoint = async (orgId: string, jobId: string, previousJobId?: string): Promise<boolean> => {
    try {
      const key = makeKey(orgId, jobId);
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      // If current jobId has no checkpoint, try previousJobId (A-860)
      if (previousJobId) {
        try {
          const prevKey = makeKey(orgId, previousJobId);
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: prevKey }));
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  };

  const deleteCheckpoint = async (orgId: string, jobId: string): Promise<void> => {
    try {
      const key = makeKey(orgId, jobId);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      console.error(`[checkpoint] Failed to delete checkpoint for job ${jobId}:`, error);
    }
  };

  return { active: true, createCheckpoint, restoreCheckpoint, hasCheckpoint, deleteCheckpoint };
};

const noopCheckpointManager: CheckpointManager = {
  active: false,
  createCheckpoint: async () => undefined,
  restoreCheckpoint: async (_containerId, _orgId, _jobId, _previousJobId?) => undefined,
  hasCheckpoint: async (_orgId, _jobId, _previousJobId?) => false,
  deleteCheckpoint: async () => undefined,
};

export const createCheckpointManager = (
  config: CheckpointManagerConfig | undefined,
  containerManager: ContainerDriver
): CheckpointManager => {
  if (!config) {
    return noopCheckpointManager;
  }
  return createActiveCheckpointManager(config, containerManager);
};
