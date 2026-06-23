import type { AgentSessionInfo, ContainerConfig } from "../../core/types";
import {
  DEFAULT_OPENCODE_CONTAINER_CONFIG,
  type OpenCodeCreateSessionInput,
  type OpenCodePromptInput,
  type OpenCodeRuntimeAgent,
  type OpenCodeRuntimeConfig,
  type OpenCodeRuntimeSessionInfo,
  type OpenCodeSession,
  type OpenCodeSessionManagerConfig,
  type OpenCodeSseEvent,
} from "./types";
import { createOpenCodeServeManager, OpenCodeServeManager } from "./serve-manager";
import { createOpenCodeSessionManager, OpenCodeSessionManager } from "./session-manager";

type OpenCodeRuntimeDeps = {
  serveManager?: OpenCodeServeManager;
  sessionManagerFactory?: (config: OpenCodeSessionManagerConfig) => OpenCodeSessionManager;
};

export class OpenCodeRuntime implements OpenCodeRuntimeAgent {
  private readonly config: OpenCodeRuntimeConfig;
  private readonly serveManager: OpenCodeServeManager;
  private readonly sessionManagerFactory: (
    config: OpenCodeSessionManagerConfig
  ) => OpenCodeSessionManager;

  private sessionManager: OpenCodeSessionManager | null = null;
  private activeSession: OpenCodeSession | null = null;

  constructor(config: OpenCodeRuntimeConfig = {}, deps: OpenCodeRuntimeDeps = {}) {
    this.config = config;
    this.serveManager =
      deps.serveManager ??
      createOpenCodeServeManager({
        command: config.command,
        host: config.host,
        port: config.port,
        auth: config.auth,
        paths: config.paths,
      });

    this.sessionManagerFactory =
      deps.sessionManagerFactory ??
      ((sessionConfig) => createOpenCodeSessionManager(sessionConfig));
  }

  public async startServer() {
    const connection = await this.serveManager.start();

    this.sessionManager = this.sessionManagerFactory({
      baseUrl: connection.baseUrl,
      auth: this.config.auth,
      paths: this.config.paths,
    });

    return connection;
  }

  public async stopServer(): Promise<void> {
    await this.serveManager.stop();
    this.sessionManager = null;
    this.activeSession = null;
  }

  public async createSession(
    input: OpenCodeCreateSessionInput
  ): Promise<OpenCodeSession> {
    const manager = await this.ensureSessionManager();

    const session = await manager.createSession({
      ...input,
      model: input.model ?? this.config.defaultModel,
      provider: input.provider ?? this.config.defaultProvider,
    });

    this.activeSession = session;
    return session;
  }

  public async resumeSession(sessionId: string): Promise<OpenCodeSession> {
    const manager = await this.ensureSessionManager();
    const session = await manager.resumeSession(sessionId);
    this.activeSession = session;
    return session;
  }

  public async sendPrompt(
    sessionId: string,
    input: OpenCodePromptInput
  ): Promise<unknown> {
    const manager = await this.ensureSessionManager();
    return manager.sendPrompt(sessionId, input);
  }

  public async *streamSessionEvents(
    sessionId?: string
  ): AsyncGenerator<OpenCodeSseEvent> {
    const manager = await this.ensureSessionManager();
    yield* manager.streamSessionEvents(sessionId);
  }

  public async buildContainerConfig(args: {
    workItem: { id: string };
    repositoryPath: string;
    envVars?: Record<string, string>;
  }): Promise<ContainerConfig> {
    const base = DEFAULT_OPENCODE_CONTAINER_CONFIG(args.repositoryPath, this.config);

    return {
      ...base,
      envVars: {
        ...base.envVars,
        ...(args.envVars ?? {}),
        ALMIRANT_WORK_ITEM_ID: args.workItem.id,
      },
    };
  }

  public parseOutput(line: string) {
    return { type: "raw" as const, line };
  }

  public async healthCheck(): Promise<boolean> {
    const connection = this.serveManager.getConnection();
    if (!connection) return false;

    const manager = this.sessionManager;
    if (!manager) {
      return this.serveManager.healthCheck();
    }

    return manager.healthCheck();
  }

  public async getSessionInfo(): Promise<AgentSessionInfo | null> {
    if (!this.activeSession) return null;

    const sessionInfo: OpenCodeRuntimeSessionInfo = {
      sessionId: this.activeSession.id,
      startedAt: this.activeSession.createdAt ?? new Date().toISOString(),
      cwd: this.activeSession.cwd,
      model: this.activeSession.model,
      provider: this.config.defaultProvider,
      metadata: this.activeSession.metadata,
    };

    return sessionInfo;
  }

  private async ensureSessionManager(): Promise<OpenCodeSessionManager> {
    if (this.sessionManager) {
      return this.sessionManager;
    }

    await this.startServer();
    if (!this.sessionManager) {
      throw new Error("OpenCodeSessionManager was not initialized");
    }

    return this.sessionManager;
  }
}

export const createOpenCodeRuntime = (
  config: OpenCodeRuntimeConfig = {},
  deps: OpenCodeRuntimeDeps = {}
): OpenCodeRuntimeAgent => new OpenCodeRuntime(config, deps);
