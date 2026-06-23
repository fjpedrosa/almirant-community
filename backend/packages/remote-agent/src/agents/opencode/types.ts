import type { AgentRuntime, AgentSessionInfo, ContainerConfig } from "../../core/types";

export type OpenCodeAuthConfig = {
  password?: string;
  token?: string;
};

export type OpenCodeApiPaths = {
  health: string;
  sessions: string;
  sessionById: (sessionId: string) => string;
  sessionPrompt: (sessionId: string) => string;
  sessionPromptAsync: (sessionId: string) => string;
  sessionEvents: (sessionId?: string) => string;
};

export type OpenCodeSseEvent = {
  id?: string;
  event?: string;
  data: string;
  raw: string;
};

export type OpenCodeSession = {
  id: string;
  status?: string;
  cwd?: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type OpenCodeCreateSessionInput = {
  cwd: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
};

export type OpenCodePromptInput = {
  prompt: string;
  metadata?: Record<string, unknown>;
};

export type OpenCodeServeManagerConfig = {
  command?: string;
  args?: string[];
  host?: string;
  port?: number;
  portRangeStart?: number;
  portRangeEnd?: number;
  readinessTimeoutMs?: number;
  readinessPollIntervalMs?: number;
  shutdownGraceMs?: number;
  auth?: OpenCodeAuthConfig;
  paths?: Partial<OpenCodeApiPaths>;
};

export type OpenCodeServeConnection = {
  baseUrl: string;
  port: number;
  pid?: number;
  ownedProcess: boolean;
};

export type OpenCodeSseClientConfig = {
  baseUrl: string;
  auth?: OpenCodeAuthConfig;
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  heartbeatTimeoutMs?: number;
};

export type OpenCodeSessionManagerConfig = {
  baseUrl: string;
  auth?: OpenCodeAuthConfig;
  timeoutMs?: number;
  paths?: Partial<OpenCodeApiPaths>;
  sse?: Partial<Pick<OpenCodeSseClientConfig, "maxReconnectAttempts" | "reconnectBaseDelayMs" | "reconnectMaxDelayMs" | "heartbeatTimeoutMs">>;
};

export type OpenCodeRuntimeConfig = {
  image?: string;
  command?: string;
  host?: string;
  port?: number;
  auth?: OpenCodeAuthConfig;
  defaultModel?: string;
  defaultProvider?: string;
  paths?: Partial<OpenCodeApiPaths>;
};

export type OpenCodeRuntimeSessionInfo = AgentSessionInfo & {
  provider?: string;
  model?: string;
};

export type OpenCodeRuntimeAgent = AgentRuntime & {
  startServer: () => Promise<OpenCodeServeConnection>;
  stopServer: () => Promise<void>;
  createSession: (input: OpenCodeCreateSessionInput) => Promise<OpenCodeSession>;
  resumeSession: (sessionId: string) => Promise<OpenCodeSession>;
  sendPrompt: (sessionId: string, input: OpenCodePromptInput) => Promise<unknown>;
  streamSessionEvents: (sessionId?: string) => AsyncGenerator<OpenCodeSseEvent>;
};

export const DEFAULT_OPENCODE_PATHS: OpenCodeApiPaths = {
  health: "/session",
  sessions: "/session",
  sessionById: (sessionId: string) => `/session/${encodeURIComponent(sessionId)}`,
  sessionPrompt: (sessionId: string) => `/session/${encodeURIComponent(sessionId)}/message`,
  sessionPromptAsync: (sessionId: string) => `/session/${encodeURIComponent(sessionId)}/prompt_async`,
  sessionEvents: (sessionId?: string) =>
    sessionId
      ? `/session/${encodeURIComponent(sessionId)}/event`
      : "/event",
};

export const DEFAULT_OPENCODE_CONTAINER_CONFIG = (
  repoPath: string,
  config: OpenCodeRuntimeConfig = {}
): ContainerConfig => {
  return {
    image: config.image ?? "ghcr.io/almirant-ai/almirant/opencode-shim:1.14.25",
    envVars: {
      OPENCODE_SERVER_HOST: config.host ?? "0.0.0.0",
      OPENCODE_SERVER_PORT: String(config.port ?? 4096),
      ...(config.auth?.password
        ? { OPENCODE_SERVER_PASSWORD: config.auth.password }
        : {}),
      ...(config.auth?.token ? { OPENCODE_SERVER_TOKEN: config.auth.token } : {}),
    },
    volumes: [
      {
        source: repoPath,
        target: "/workspace",
        readOnly: false,
      },
    ],
    entrypoint: ["/bin/sh", "-lc"],
    command: [config.command ?? "opencode serve --port ${OPENCODE_SERVER_PORT}"],
  };
};
