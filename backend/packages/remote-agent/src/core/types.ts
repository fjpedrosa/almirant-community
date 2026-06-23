import type {
  AlmirantWorkerClient,
  UpdateJobStatusPayload,
  WorkItemDetails,
} from "../client/types";
import type { OutputEvent } from "./events";
import type { SessionState } from "./state";

export type ContainerResourceLimits = {
  cpuLimit?: number;
  memoryLimitMb?: number;
  pidsLimit?: number;
};

export type ContainerVolumeMount = {
  source: string;
  target: string;
  readOnly?: boolean;
};

export type ContainerConfig = {
  image: string;
  envVars: Record<string, string>;
  volumes: ContainerVolumeMount[];
  entrypoint?: string[];
  command?: string[];
  resourceLimits?: ContainerResourceLimits;
};

export type AgentSessionInfo = {
  sessionId: string;
  startedAt: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
};

export type AgentRuntime = {
  buildContainerConfig: (args: {
    workItem: WorkItemDetails;
    repositoryPath: string;
    envVars?: Record<string, string>;
  }) => Promise<ContainerConfig>;
  parseOutput: (line: string) => OutputEvent;
  healthCheck: () => Promise<boolean>;
  getSessionInfo: () => Promise<AgentSessionInfo | null>;
};

export type ChannelMessage = {
  id: string;
  content: string;
};

export type ChannelThread = {
  id: string;
  name: string;
  archived?: boolean;
};

export type ChannelAdapter = {
  sendMessage: (threadId: string, content: string) => Promise<ChannelMessage>;
  editMessage: (threadId: string, messageId: string, content: string) => Promise<ChannelMessage>;
  createThread: (args: {
    channelId: string;
    name: string;
    reason?: string;
    autoArchiveDurationMinutes?: 60 | 1440 | 4320 | 10080;
  }) => Promise<ChannelThread>;
  renameThread: (threadId: string, name: string) => Promise<ChannelThread>;
  archiveThread: (threadId: string) => Promise<void>;
  addReaction: (threadId: string, messageId: string, emoji: string) => Promise<void>;
};

export type OutputStreamRouterOptions = {
  threadId: string;
  jobId?: string;
  sessionId?: string;
  organizationId?: string;
  maxBufferChars?: number;
  stagnantTimeoutMs?: number;
  messageEditThrottleMs?: number;
};

export type OutputStreamRouterResult = {
  state: SessionState;
  bytesProcessed: number;
  linesProcessed: number;
  lastMessageId?: string;
};

export type OutputStreamRouter = {
  consume: (
    stream: ReadableStream<Uint8Array | string>,
    options: OutputStreamRouterOptions
  ) => Promise<OutputStreamRouterResult>;
  stop: () => Promise<void>;
  getState: () => SessionState;
};

export type WorkerStatusReporter = Pick<AlmirantWorkerClient, "updateJobStatus">;

export type WorkerStatusUpdateInput = {
  jobId: string;
  payload: UpdateJobStatusPayload;
};

export type WorkerStatusUpdate = (
  input: WorkerStatusUpdateInput
) => Promise<void>;
