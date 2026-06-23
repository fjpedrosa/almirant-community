import type {
  OpenCodeApiPaths,
  OpenCodeServeConnection,
  OpenCodeServeManagerConfig,
} from "./types";
import { DEFAULT_OPENCODE_PATHS } from "./types";

type SpawnedProcess = {
  pid?: number;
  stdout?: ReadableStream<Uint8Array> | null;
  stderr?: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill: (signal?: string | number) => void;
};

type ServeManagerDeps = {
  fetchFn?: typeof fetch;
  spawnFn?: (cmd: string[], cwd?: string) => SpawnedProcess;
  sleepFn?: (ms: number) => Promise<void>;
};

export class OpenCodeServeManager {
  private readonly config: Required<
    Pick<
      OpenCodeServeManagerConfig,
      | "command"
      | "args"
      | "host"
      | "portRangeStart"
      | "portRangeEnd"
      | "readinessTimeoutMs"
      | "readinessPollIntervalMs"
      | "shutdownGraceMs"
    >
  > &
    Pick<OpenCodeServeManagerConfig, "port" | "auth"> & {
      paths: OpenCodeApiPaths;
    };

  private readonly fetchFn: typeof fetch;
  private readonly spawnFn: (cmd: string[], cwd?: string) => SpawnedProcess;
  private readonly sleepFn: (ms: number) => Promise<void>;

  private process: SpawnedProcess | null = null;
  private connection: OpenCodeServeConnection | null = null;

  constructor(config: OpenCodeServeManagerConfig = {}, deps: ServeManagerDeps = {}) {
    this.config = {
      command: config.command ?? "opencode",
      args: config.args ?? [],
      host: config.host ?? "127.0.0.1",
      port: config.port,
      portRangeStart: config.portRangeStart ?? 4096,
      portRangeEnd: config.portRangeEnd ?? 4196,
      readinessTimeoutMs: config.readinessTimeoutMs ?? 30_000,
      readinessPollIntervalMs: config.readinessPollIntervalMs ?? 400,
      shutdownGraceMs: config.shutdownGraceMs ?? 2_500,
      auth: config.auth,
      paths: {
        ...DEFAULT_OPENCODE_PATHS,
        ...(config.paths ?? {}),
      },
    };

    this.fetchFn = deps.fetchFn ?? fetch;
    this.spawnFn =
      deps.spawnFn ??
      ((cmd) =>
        Bun.spawn({
          cmd,
          stdout: "pipe",
          stderr: "pipe",
        }) as unknown as SpawnedProcess);
    this.sleepFn = deps.sleepFn ?? (async (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public getConnection(): OpenCodeServeConnection | null {
    return this.connection;
  }

  public async start(): Promise<OpenCodeServeConnection> {
    if (this.connection) {
      return this.connection;
    }

    const candidatePorts = this.buildCandidatePorts();
    let lastError: Error | null = null;

    for (const port of candidatePorts) {
      const baseUrl = `http://${this.config.host}:${port}`;

      try {
        const alreadyRunning = await this.probeHealth(baseUrl);
        if (alreadyRunning) {
          this.connection = {
            baseUrl,
            port,
            ownedProcess: false,
          };
          return this.connection;
        }

        const cmd = [
          this.config.command,
          "serve",
          "--port",
          String(port),
          ...this.config.args,
        ];

        const process = this.spawnFn(cmd);

        const isReady = await this.waitForReadiness(baseUrl);
        if (!isReady) {
          process.kill("SIGTERM");
          lastError = new Error(`OpenCode did not become ready on port ${port}`);
          continue;
        }

        this.process = process;
        this.connection = {
          baseUrl,
          port,
          pid: process.pid,
          ownedProcess: true,
        };

        return this.connection;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw (
      lastError ??
      new Error(
        `Failed to start OpenCode serve in range ${this.config.portRangeStart}-${this.config.portRangeEnd}`
      )
    );
  }

  public async stop(): Promise<void> {
    if (!this.connection?.ownedProcess || !this.process) {
      this.connection = null;
      this.process = null;
      return;
    }

    const currentProcess = this.process;

    currentProcess.kill("SIGTERM");

    const exitOrTimeout = await Promise.race([
      currentProcess.exited.then(() => "exited" as const),
      this.sleepFn(this.config.shutdownGraceMs).then(() => "timeout" as const),
    ]);

    if (exitOrTimeout === "timeout") {
      currentProcess.kill("SIGKILL");
      await currentProcess.exited.catch(() => undefined);
    }

    this.connection = null;
    this.process = null;
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.connection) return false;
    return this.probeHealth(this.connection.baseUrl);
  }

  private buildCandidatePorts(): number[] {
    if (this.config.port != null) {
      return [this.config.port];
    }

    const ports: number[] = [];
    for (let port = this.config.portRangeStart; port <= this.config.portRangeEnd; port += 1) {
      ports.push(port);
    }
    return ports;
  }

  private async waitForReadiness(baseUrl: string): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.config.readinessTimeoutMs) {
      const ok = await this.probeHealth(baseUrl);
      if (ok) return true;
      await this.sleepFn(this.config.readinessPollIntervalMs);
    }

    return false;
  }

  private async probeHealth(baseUrl: string): Promise<boolean> {
    const url = `${baseUrl}${this.config.paths.health}`;

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: this.buildAuthHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildAuthHeaders(): Headers {
    const headers = new Headers();

    if (this.config.auth?.token) {
      headers.set("Authorization", `Bearer ${this.config.auth.token}`);
    } else if (this.config.auth?.password) {
      const encoded = Buffer.from(`:${this.config.auth.password}`).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    return headers;
  }
}

export const createOpenCodeServeManager = (
  config: OpenCodeServeManagerConfig = {},
  deps: ServeManagerDeps = {}
): OpenCodeServeManager => new OpenCodeServeManager(config, deps);
